"""
多 Agent 协同工具 —— Python 服务主入口（M5）
端口: 18081，仅监听 localhost
Tauri 启动时由 python_manager.rs 自动拉起，关闭时随之终止。
"""
import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from tools.router import router as tools_router
from tools.llm_calling import LLM_CALLING_VERSION
from web_reader import router as web_router

# 服务鉴权令牌:由 Rust(python_manager.rs)启动时经 env 传入,前端每次请求带 X-Service-Token 头。
# 阻止本机其它程序/恶意网页直接打 localhost:18081 调工具/装工具。
# 令牌为空(手动/dev 启动、未经 app)时不启用鉴权,兼容环境配置器与浏览器预览。
SERVICE_TOKEN = os.environ.get("MULTIAGENT_SERVICE_TOKEN", "")

# 应用日志统一走 root logger 输出到 stderr，由 Tauri 侧重定向落盘到 logs/python.log。
# uvicorn 自身日志器不受此影响（仍按 --log-level warning）；此处只管应用模块（router/llm_calling 等）。
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

SERVICE_VERSION = LLM_CALLING_VERSION

app = FastAPI(title="Multi-Agent Tool Service", version=SERVICE_VERSION)
MAX_REQUEST_BODY_SIZE = 60 * 1024 * 1024


class _BodyTooLarge(Exception):
    """请求体累计字节超过上限的内部信号，仅在 _BodySizeLimitMiddleware 内捕获。"""


class _BodySizeLimitMiddleware:
    """纯 ASGI 中间件：限制请求体大小，把请求头当不可信输入。

    - Content-Length 头非数字/负数 → 400（不再让 int() 抛未捕获异常变成 500）。
    - Content-Length 超上限 → 413（读 body 前就拒绝）。
    - 无 Content-Length 的分块请求：在 receive 侧累计实际读入字节，超限即 413 终止，
      不依赖头部声明（BaseHTTPMiddleware 无法可靠包裹下游 receive，故用纯 ASGI 层）。
    """

    def __init__(self, app, max_body_size: int) -> None:
        self.app = app
        self.max_body_size = max_body_size

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        raw_len = headers.get(b"content-length")
        if raw_len is not None:
            try:
                declared = int(raw_len)
            except (TypeError, ValueError):
                await self._reject(send, 400, "Content-Length 非法")
                return
            if declared < 0:
                await self._reject(send, 400, "Content-Length 非法")
                return
            if declared > self.max_body_size:
                await self._reject(send, 413, "请求体过大")
                return

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_size:
                    raise _BodyTooLarge()
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _BodyTooLarge:
            # endpoint 在读 body 阶段就会触发，此时尚未开始发送响应，可安全回 413。
            await self._reject(send, 413, "请求体过大")

    @staticmethod
    async def _reject(send, status: int, detail: str) -> None:
        """在 ASGI 层直接发送一个 JSON 错误响应（不依赖 request/scope）。"""
        response = JSONResponse(status_code=status, content={"detail": detail})
        await send({
            "type": "http.response.start",
            "status": response.status_code,
            "headers": response.raw_headers,
        })
        await send({"type": "http.response.body", "body": response.body})


# 请求体大小限制：最内层，紧贴路由，其 limited_receive 直接喂给 endpoint。
app.add_middleware(_BodySizeLimitMiddleware, max_body_size=MAX_REQUEST_BODY_SIZE)


@app.middleware("http")
async def require_service_token(request: Request, call_next):
    """令牌校验:/health 与 OPTIONS 预检豁免;令牌未配置(空)时不启用(兼容手动/dev 启动)。
    仅当 Rust 启动并传入令牌时生效——此时任何不带正确令牌的本机请求都被 401 拒绝。"""
    if (
        SERVICE_TOKEN
        and request.method != "OPTIONS"
        and request.url.path != "/health"
        and request.headers.get("x-service-token") != SERVICE_TOKEN
    ):
        return JSONResponse(status_code=401, content={"detail": "服务令牌无效或缺失"})
    return await call_next(request)


# 仅允许前端本地来源（Tauri WebView 的 origin 为 tauri://localhost 或 http://localhost:5173）
# 最外层：先处理 CORS/预检，再进入令牌与体积检查。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["tauri://localhost", "http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Service-Token"],
)

app.include_router(tools_router)
app.include_router(web_router)


@app.get("/health")
def health() -> dict:
    """Tauri 前端通过此接口轮询服务是否就绪。"""
    return {"status": "ok", "serviceVersion": SERVICE_VERSION}
