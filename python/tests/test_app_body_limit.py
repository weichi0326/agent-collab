"""P1-1 / P1-2 回归测试：请求体大小限制中间件（_BodySizeLimitMiddleware）。

直接以 ASGI 三元组驱动中间件，不依赖 HTTP 客户端：
- P1-1：Content-Length 非数字/负数 → 400（不再让 int() 抛未捕获异常成 500）。
- P1-1：合法但超上限的 Content-Length → 413（读 body 前拒绝）。
- P1-2：无 Content-Length 的分块请求按实际读入字节累计，超限 → 413。
- 合法（缺失/合法/边界内）请求 → 正常 200。
"""
import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import _BodySizeLimitMiddleware

MAX = 100


async def _downstream(scope, receive, send):
    """模拟 endpoint：读完请求体再回 200。"""
    while True:
        msg = await receive()
        if msg["type"] == "http.request" and not msg.get("more_body"):
            break
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b"ok"})


def _run(headers, chunks):
    """跑一次中间件；返回 http.response.start 的 status。chunks: list[(bytes, more_body)]。"""
    mw = _BodySizeLimitMiddleware(_downstream, max_body_size=MAX)
    scope = {"type": "http", "method": "POST", "path": "/x", "headers": headers}
    pending = list(chunks)
    sent: list = []

    async def receive():
        if pending:
            body, more = pending.pop(0)
            return {"type": "http.request", "body": body, "more_body": more}
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    asyncio.run(mw(scope, receive, send))
    return next(m["status"] for m in sent if m["type"] == "http.response.start")


class BodyLimitContentLengthTests(unittest.TestCase):
    def test_non_numeric_content_length_returns_400(self):
        self.assertEqual(_run([(b"content-length", b"abc")], []), 400)

    def test_negative_content_length_returns_400(self):
        self.assertEqual(_run([(b"content-length", b"-5")], []), 400)

    def test_oversize_content_length_returns_413(self):
        self.assertEqual(_run([(b"content-length", str(MAX + 1).encode())], []), 413)

    def test_within_limit_content_length_passes(self):
        self.assertEqual(
            _run([(b"content-length", b"10")], [(b"x" * 10, False)]),
            200,
        )

    def test_missing_content_length_empty_body_passes(self):
        self.assertEqual(_run([], [(b"", False)]), 200)


class BodyLimitChunkedTests(unittest.TestCase):
    def test_chunked_over_limit_returns_413(self):
        # 无 Content-Length，分块累计 160 > 100 → 413
        chunks = [(b"x" * 80, True), (b"y" * 80, False)]
        self.assertEqual(_run([], chunks), 413)

    def test_chunked_under_limit_passes(self):
        chunks = [(b"x" * 40, True), (b"y" * 40, False)]
        self.assertEqual(_run([], chunks), 200)

    def test_chunked_without_content_length_but_declares_small_still_capped(self):
        # 声明合法小 Content-Length，但实际分块塞超量 → 仍按真实字节 413（防绕过）
        chunks = [(b"x" * 80, True), (b"y" * 80, False)]
        self.assertEqual(_run([(b"content-length", b"10")], chunks), 413)


class BodyLimitNonHttpScopeTests(unittest.TestCase):
    def test_non_http_scope_passes_through(self):
        mw = _BodySizeLimitMiddleware(_downstream, max_body_size=MAX)
        called = {"v": False}

        async def app(scope, receive, send):
            called["v"] = True

        mw.app = app
        asyncio.run(mw({"type": "lifespan"}, None, None))
        self.assertTrue(called["v"])


if __name__ == "__main__":
    unittest.main()
