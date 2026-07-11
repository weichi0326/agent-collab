"""
llm-calling 工具：在 Python 服务端代理调用 LLM API（无 CORS 限制）。
params:
  api        (str, 必填) "openai" | "anthropic" | "gemini"
  base_url   (str, 必填) API baseURL（须通过 SSRF 白名单或域名校验）
  api_key    (str, 必填) 密钥（由 Agent Runner 在调用时传入，不落盘）
  model      (str, 必填) 模型 ID
  messages   (list, 必填) 消息列表 [{ role, content }]（最多 200 轮）
  system     (str, 可选) 系统提示词
  max_tokens (int, 可选) 最大回复 token 数，默认 4096，上限 16384
"""
import ipaddress
import asyncio
import json
import logging
import socket
import time
from typing import Any
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

# ⚠️ 单一来源纪律:凡改动任何工具的返回结构/行为(如本文件新增 usage 返回),
# 必须同步升本版本号 + 前端 app/src/lib/pythonClient.ts 的 EXPECTED_PYTHON_SERVICE_VERSION,
# 二者必须完全一致。否则 ensureCompatiblePythonService 无法识别旧后台、不触发强制重启,
# 用户会跑着旧代码却以为功能坏了(如 Token 统计恒 0)。
LLM_CALLING_VERSION = "2026-07-11.custom-model-endpoints"
TIMEOUT = 300  # 秒
CONNECT_TIMEOUT = 15
MAX_RETRIES = 2
HTTP_RETRY_STATUSES = {429, 500, 502, 503, 504}
TRANSIENT_REQUEST_ERRORS = (
    requests.ConnectionError,
    requests.Timeout,
    requests.exceptions.ChunkedEncodingError,
)

# H2 修复：已知 LLM 厂商允许的域名白名单（与前端 providers.ts 保持同步）
_ALLOWED_DOMAINS: set[str] = {
    "dashscope.aliyuncs.com",
    "open.bigmodel.cn",
    "api.deepseek.com",
    "api.moonshot.cn",
    "api.minimax.chat",
    "api.xiaomimimo.com",
    "api.openai.com",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
    "api.x.ai",
    "api.siliconflow.cn",
    "openrouter.ai",
    "api.together.xyz",
    # 允许 localhost 调试（仅限本机）
    "localhost",
    "127.0.0.1",
}

# L22 修复：max_tokens 上限
MAX_TOKENS_LIMIT = 16_384
MAX_MESSAGES = 200


def _is_non_public_ip(ip_str: str) -> bool:
    """返回 True 表示该 IP 不是可安全访问的公网单播地址。"""
    try:
        return not ipaddress.ip_address(ip_str).is_global
    except ValueError:
        return True


def _validate_base_url(base_url: str) -> str:
    """允许预设或用户明确配置的公网 HTTPS，以及显式 localhost 本地服务。"""
    parsed = urlparse(base_url)
    if parsed.username or parsed.password:
        raise ValueError("base_url 不能包含用户名或密码")
    if parsed.query or parsed.fragment:
        raise ValueError("base_url 不能包含查询参数或片段")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError("base_url 缺少主机名")
    local_hosts = {"localhost", "127.0.0.1"}
    is_local = hostname in local_hosts
    if parsed.scheme != "https" and not (parsed.scheme == "http" and is_local):
        raise ValueError("自定义模型仅允许公网 HTTPS 地址；HTTP 只允许 localhost 本地服务")

    if is_local:
        return base_url.rstrip("/")

    try:
        port = parsed.port or 443
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
        }
    except (socket.gaierror, ValueError) as exc:
        raise ValueError(f"base_url 主机名 '{hostname}' 无法解析") from exc

    if not addresses:
        raise ValueError(f"base_url 主机名 '{hostname}' 没有可用 IP")
    blocked = next((ip for ip in addresses if _is_non_public_ip(ip)), None)
    if blocked:
        raise ValueError(
            f"拒绝访问私网、回环、链路本地或保留地址 '{hostname}' ({blocked})，防止 SSRF 攻击。"
        )
    return base_url.rstrip("/")


def _is_transient_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return isinstance(
        exc,
        TRANSIENT_REQUEST_ERRORS,
    ) or any(
        item in text
        for item in (
            "response ended prematurely",
            "remote end closed connection",
            "connection reset",
            "read timed out",
        )
    )


def _post_json(url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    last_exc: BaseException | None = None
    try:
        payload_kb = len(json.dumps(payload, ensure_ascii=False)) // 1024
    except (TypeError, ValueError):
        payload_kb = 0
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = requests.post(
                url,
                headers={
                    **headers,
                    "Content-Type": "application/json",
                    # 部分中转/厂商在 gzip + chunked 响应异常时会提前断流。
                    # 关闭压缩可减少 "Response ended prematurely" 的概率。
                    "Accept-Encoding": "identity",
                },
                json=payload,
                timeout=(CONNECT_TIMEOUT, TIMEOUT),
                allow_redirects=False,
            )
            if 300 <= resp.status_code < 400:
                raise RuntimeError("LLM 服务返回重定向，已拒绝跟随以防止凭据泄露")
            resp.raise_for_status()
            try:
                return resp.json()
            except ValueError as exc:
                raise RuntimeError("LLM 返回内容不是合法 JSON，请稍后重试或检查模型服务状态") from exc
        except requests.HTTPError as exc:
            last_exc = exc
            status = exc.response.status_code if exc.response is not None else 0
            if attempt < MAX_RETRIES and status in HTTP_RETRY_STATUSES:
                retry_after = exc.response.headers.get("retry-after") if exc.response is not None else None
                try:
                    delay = float(retry_after) if retry_after else 1.2 * (attempt + 1)
                except ValueError:
                    delay = 1.2 * (attempt + 1)
                delay = min(delay, 8)
                logger.warning(
                    "[llm] HTTP %s，第 %d/%d 次重试，%.1fs 后重发（请求体约 %dKB）",
                    status, attempt + 1, MAX_RETRIES, delay, payload_kb,
                )
                time.sleep(delay)
                continue
            raise
        except requests.RequestException as exc:
            last_exc = exc
            if attempt >= MAX_RETRIES or not _is_transient_error(exc):
                break
            delay = 0.8 * (attempt + 1)
            logger.warning(
                "[llm] 连接瞬断（%s: %s），第 %d/%d 次重试，%.1fs 后重发（请求体约 %dKB）",
                type(exc).__name__, exc, attempt + 1, MAX_RETRIES, delay, payload_kb,
            )
            time.sleep(delay)
    logger.error(
        "[llm] 已重试 %d 次仍失败，放弃（请求体约 %dKB）：%s",
        MAX_RETRIES, payload_kb, last_exc,
    )
    raise RuntimeError(
        "LLM 连接中途断开，已自动重试但仍未成功。"
        "模型配置的短测试通过不代表长输入/长输出任务一定稳定；"
        f"本次请求体约 {payload_kb}KB。请稍后重试，或换用更稳定/更大上下文的模型。"
    ) from last_exc


def _call_openai(base_url: str, api_key: str, model: str,
                 messages: list, max_tokens: int) -> tuple[str, int]:
    """返回 (content, total_tokens)。usage 缺失时 total=0(静默,不报错)。"""
    url = f"{base_url}/chat/completions"
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        data = _post_json(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            payload={"model": model, "messages": messages, "max_tokens": max_tokens},
        )
        # L4 修复：健壮的响应解析
        choices = data.get("choices") or []
        if not choices:
            last_error = ValueError("LLM 返回空 choices 列表")
        else:
            content = choices[0].get("message", {}).get("content")
            if not isinstance(content, str):
                raise ValueError("返回格式无法解析：缺少 choices[0].message.content 字段")
            if content.strip():
                usage = data.get("usage") or {}
                total = usage.get("total_tokens") or 0
                return content, int(total)
            last_error = ValueError("LLM 返回空内容，请稍后重试或更换可用模型")
        if attempt < MAX_RETRIES:
            time.sleep(0.8 * (attempt + 1))
    raise last_error or ValueError("LLM 返回空内容，请稍后重试或更换可用模型")


def _call_anthropic(base_url: str, api_key: str, model: str,
                    system: str | None, messages: list, max_tokens: int) -> tuple[str, int]:
    """返回 (text, total_tokens)。anthropic 无 total 字段,用 input+output 相加。"""
    url = f"{base_url}/messages"
    body: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
    }
    if system:
        body["system"] = system
    data = _post_json(
        url,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        payload=body,
    )
    blocks = data.get("content") or []
    text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
    usage = data.get("usage") or {}
    total = (usage.get("input_tokens") or 0) + (usage.get("output_tokens") or 0)
    return text or "(空回复)", int(total)


async def execute(params: dict[str, Any]) -> Any:
    api: str = params.get("api", "openai")
    base_url_raw: str = params.get("base_url", "")
    api_key: str = params.get("api_key", "")
    model: str = params.get("model", "")
    messages: list = params.get("messages", [])
    system: str | None = params.get("system")

    # L22 修复：max_tokens 上限
    max_tokens: int = min(int(params.get("max_tokens", 4096)), MAX_TOKENS_LIMIT)

    if not base_url_raw:
        raise ValueError("缺少必填参数 base_url")
    if not api_key:
        raise ValueError("缺少必填参数 api_key")
    if not model:
        raise ValueError("缺少必填参数 model")
    if not messages:
        raise ValueError("缺少必填参数 messages")
    if len(messages) > MAX_MESSAGES:
        raise ValueError(f"messages 超过 {MAX_MESSAGES} 轮上限")

    # H2：SSRF 防护校验
    base_url = _validate_base_url(base_url_raw)

    try:
        if api == "anthropic":
            reply, total_tokens = await asyncio.to_thread(
                _call_anthropic,
                base_url,
                api_key,
                model,
                system,
                messages,
                max_tokens,
            )
        else:
            if system:
                messages = [{"role": "system", "content": system}] + list(messages)
            reply, total_tokens = await asyncio.to_thread(
                _call_openai,
                base_url,
                api_key,
                model,
                messages,
                max_tokens,
            )
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 0
        detail = ""
        try:
            detail = (e.response.json().get("error") or {}).get("message", "")
        except Exception:
            pass
        raise RuntimeError(f"LLM 请求失败 ({status}){': ' + detail if detail else ''}") from e
    except requests.RequestException as e:
        raise RuntimeError(f"LLM 网络请求失败：{e}") from e
    except Exception as e:
        raise RuntimeError(f"LLM 工具处理失败：{e}") from e

    return {"reply": reply, "model": model, "usage": {"total": total_tokens}}
