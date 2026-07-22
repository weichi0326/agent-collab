"""受限网页正文读取：为姬子深度搜索提供 SSRF 防护与有界文本。"""
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from safe_http import PUBLIC_POLICY, pinned_request

router = APIRouter(prefix="/web")
MAX_BYTES = 2 * 1024 * 1024
MAX_TEXT = 80_000
MAX_REDIRECTS = 3
TIMEOUT_SECONDS = 10


class _TextExtractor(HTMLParser):
    _SKIP = {"script", "style", "nav", "form", "noscript", "svg"}

    def __init__(self) -> None:
        super().__init__()
        self.depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in self._SKIP:
            self.depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in self._SKIP and self.depth > 0:
            self.depth -= 1

    def handle_data(self, data: str) -> None:
        if self.depth == 0 and data.strip():
            self.parts.append(data.strip())


def extract_readable_text(content: str, content_type: str) -> str:
    if "html" not in content_type:
        return " ".join(content.split())[:MAX_TEXT]
    parser = _TextExtractor()
    parser.feed(content)
    return " ".join(" ".join(parser.parts).split())[:MAX_TEXT]


def read_web_page(url: str) -> dict[str, Any]:
    current = url.strip()
    for redirect_count in range(MAX_REDIRECTS + 1):
        with pinned_request(
            "GET",
            current,
            policy=PUBLIC_POLICY,
            stream=True,
            timeout=TIMEOUT_SECONDS,
            headers={"User-Agent": "JiziResearch/1.0", "Accept": "text/html,text/plain"},
        ) as response:
            if response.is_redirect or response.is_permanent_redirect:
                if redirect_count >= MAX_REDIRECTS:
                    raise ValueError("网页重定向次数过多")
                location = response.headers.get("location")
                if not location:
                    raise ValueError("网页重定向缺少目标")
                current = urljoin(current, location)
                continue
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").lower()
            if not (content_type.startswith("text/") or "html" in content_type):
                raise ValueError("网页响应不是可读取文本")
            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_content(chunk_size=65_536):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise ValueError("网页响应超过 2MB 上限")
                chunks.append(chunk)
            encoding = response.encoding or "utf-8"
            raw = b"".join(chunks).decode(encoding, errors="replace")
            return {
                "url": current,
                "contentType": content_type,
                "text": extract_readable_text(raw, content_type),
            }
    raise ValueError("网页读取失败")


class ReadWebRequest(BaseModel):
    url: str


@router.post("/read")
def read_web(body: ReadWebRequest) -> dict[str, Any]:
    try:
        return read_web_page(body.url)
    except (ValueError, requests.RequestException) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
