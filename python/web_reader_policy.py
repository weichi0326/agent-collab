"""网页读取的纯 URL/DNS 安全策略，不依赖 Web 框架。"""
import ipaddress
import socket
from urllib.parse import urlsplit


def validate_public_url(url: str) -> str:
    parsed = urlsplit(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("只允许 http 或 https 公网地址")
    if parsed.username or parsed.password:
        raise ValueError("网页地址不能包含凭据")
    if parsed.hostname.lower() == "localhost":
        raise ValueError("网页地址必须指向公网主机")
    try:
        addresses = socket.getaddrinfo(
            parsed.hostname,
            parsed.port or (443 if parsed.scheme == "https" else 80),
            type=socket.SOCK_STREAM,
        )
    except OSError as exc:
        raise ValueError("网页主机无法解析") from exc
    if not addresses:
        raise ValueError("网页主机无法解析")
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise ValueError("网页地址必须解析到公网 IP")
    return url.strip()
