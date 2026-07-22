"""
llm-calling 工具：在 Python 服务端代理调用 LLM API（无 CORS 限制）。
params:
  action     (str, 可选) "chat"（默认）| "list_models"
  api        (str, 必填) "openai" | "anthropic" | "gemini"
  base_url   (str, 必填) API baseURL（须通过 SSRF 白名单或域名校验）
  api_key    (str, 必填) 密钥（由 Agent Runner 在调用时传入，不落盘）
  model      (str, 必填) 模型 ID
  messages   (list, 必填) 消息列表 [{ role, content }]（最多 200 轮）
  system     (str, 可选) 系统提示词
  max_tokens (int, 可选) 最大回复 token 数，默认 4096，上限 30000
  temperature(float, 可选) 采样温度，范围 0-2
"""
import asyncio
import json
import logging
import time
from typing import Any

import requests
from network_policy import validate_model_base_url as _validate_base_url
from safe_http import MODEL_POLICY, pinned_request

logger = logging.getLogger(__name__)

# ⚠️ 单一来源纪律:凡改动任何工具的返回结构/行为(如本文件新增 usage 返回),
# 必须同步升本版本号 + 前端 app/src/lib/pythonClient.ts 的 EXPECTED_PYTHON_SERVICE_VERSION,
# 二者必须完全一致。否则 ensureCompatiblePythonService 无法识别旧后台、不触发强制重启,
# 用户会跑着旧代码却以为功能坏了(如 Token 统计恒 0)。
LLM_CALLING_VERSION = "2026-07-22.code-audit"
TIMEOUT = 300  # 秒
CONNECT_TIMEOUT = 15
MAX_RETRIES = 2
HTTP_RETRY_STATUSES = {429, 500, 502, 503, 504}
TRANSIENT_REQUEST_ERRORS = (
    requests.ConnectionError,
    requests.Timeout,
    requests.exceptions.ChunkedEncodingError,
)

# L22 修复：max_tokens 上限
MAX_TOKENS_LIMIT = 30_000
MAX_MESSAGES = 200


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
            with pinned_request(
                "POST",
                url,
                policy=MODEL_POLICY,
                headers={
                    **headers,
                    "Content-Type": "application/json",
                    # 部分中转/厂商在 gzip + chunked 响应异常时会提前断流。
                    # 关闭压缩可减少 "Response ended prematurely" 的概率。
                    "Accept-Encoding": "identity",
                },
                json=payload,
                timeout=(CONNECT_TIMEOUT, TIMEOUT),
            ) as resp:
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


def _list_models(base_url: str, api_key: str, api: str) -> list[str]:
    headers = (
        {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        }
        if api == "anthropic"
        else {"Authorization": f"Bearer {api_key}"}
    )
    with pinned_request(
        "GET",
        f"{base_url}/models",
        policy=MODEL_POLICY,
        headers={**headers, "Accept-Encoding": "identity"},
        timeout=(CONNECT_TIMEOUT, TIMEOUT),
    ) as resp:
        if 300 <= resp.status_code < 400:
            raise RuntimeError("LLM 服务返回重定向，已拒绝跟随以防止凭据泄露")
        resp.raise_for_status()
        try:
            data = resp.json()
        except ValueError as exc:
            raise RuntimeError("LLM 返回内容不是合法 JSON，请稍后重试或检查模型服务状态") from exc

    raw_models = data.get("data") if isinstance(data, dict) else None
    if not isinstance(raw_models, list) and isinstance(data, dict):
        raw_models = data.get("models")
    if not isinstance(raw_models, list):
        raise ValueError("返回格式无法解析：缺少模型列表")

    models: list[str] = []
    for item in raw_models:
        value = item if isinstance(item, str) else None
        if isinstance(item, dict):
            value = item.get("id") or item.get("name")
        if isinstance(value, str) and value:
            models.append(value)
    return models


def _call_openai(base_url: str, api_key: str, model: str,
                 messages: list, max_tokens: int,
                 temperature: float | None = None) -> tuple[str, int]:
    """返回 (content, total_tokens)。usage 缺失时 total=0(静默,不报错)。"""
    url = f"{base_url}/chat/completions"
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        data = _post_json(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            payload=payload,
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
                    system: str | None, messages: list, max_tokens: int,
                    temperature: float | None = None) -> tuple[str, int]:
    """返回 (text, total_tokens)。anthropic 无 total 字段,用 input+output 相加。"""
    url = f"{base_url}/messages"
    body: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
    }
    if system:
        body["system"] = system
    if temperature is not None:
        body["temperature"] = temperature
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
    action: str = params.get("action", "chat")
    api: str = params.get("api", "openai")
    base_url_raw: str = params.get("base_url", "")
    api_key: str = params.get("api_key", "")
    model: str = params.get("model", "")
    messages: list = params.get("messages", [])
    system: str | None = params.get("system")

    if not base_url_raw:
        raise ValueError("缺少必填参数 base_url")
    if not api_key:
        raise ValueError("缺少必填参数 api_key")
    if action not in {"chat", "list_models"}:
        raise ValueError(f"不支持的 action: {action}")

    # H2：SSRF 防护校验
    base_url = _validate_base_url(base_url_raw)

    if action == "chat":
        if not model:
            raise ValueError("缺少必填参数 model")
        if not messages:
            raise ValueError("缺少必填参数 messages")
        if len(messages) > MAX_MESSAGES:
            raise ValueError(f"messages 超过 {MAX_MESSAGES} 轮上限")

    try:
        if action == "list_models":
            models = await asyncio.to_thread(_list_models, base_url, api_key, api)
            return {"models": models}

        # L22 修复：max_tokens 上限
        max_tokens: int = min(int(params.get("max_tokens", 4096)), MAX_TOKENS_LIMIT)
        temperature_raw = params.get("temperature")
        temperature: float | None = None
        if temperature_raw is not None:
            temperature = min(2.0, max(0.0, float(temperature_raw)))

        if api == "anthropic":
            reply, total_tokens = await asyncio.to_thread(
                _call_anthropic,
                base_url,
                api_key,
                model,
                system,
                messages,
                max_tokens,
                temperature,
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
                temperature,
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
