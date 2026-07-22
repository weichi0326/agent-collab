"""Shared URL/IP policy for public fetches and configured model endpoints."""

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit

MODEL_LOCAL_HOSTS = {"localhost", "127.0.0.1"}
NAT64_WELL_KNOWN_PREFIX = ipaddress.ip_network("64:ff9b::/96")


@dataclass(frozen=True)
class ResolvedTarget:
    url: str
    hostname: str
    port: int
    addresses: tuple[str, ...]
    host_header: str


def _effective_ip(address: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return ip.ipv4_mapped
        if ip in NAT64_WELL_KNOWN_PREFIX:
            return ipaddress.IPv4Address(int(ip) & 0xFFFF_FFFF)
    return ip


def is_public_ip(address: str) -> bool:
    try:
        return _effective_ip(address).is_global
    except ValueError:
        return False


def _resolved_addresses(hostname: str, port: int, label: str) -> tuple[str, ...]:
    try:
        addresses = tuple(
            dict.fromkeys(
                item[4][0]
                for item in socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
            )
        )
    except (socket.gaierror, OSError, ValueError) as exc:
        raise ValueError(f"{label}主机名 '{hostname}' 无法解析") from exc
    if not addresses:
        raise ValueError(f"{label}主机名 '{hostname}' 没有可用 IP")
    return addresses


def _host_header(hostname: str, port: int, scheme: str) -> str:
    host = f"[{hostname}]" if ":" in hostname else hostname
    default_port = 443 if scheme == "https" else 80
    return host if port == default_port else f"{host}:{port}"


def resolve_public_target(url: str) -> ResolvedTarget:
    value = url.strip()
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("只允许 http 或 https 公网地址")
    if parsed.username or parsed.password:
        raise ValueError("网页地址不能包含凭据")
    hostname = parsed.hostname.lower()
    if hostname == "localhost":
        raise ValueError("网页地址必须指向公网主机")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    addresses = _resolved_addresses(hostname, port, "网页")
    if any(not is_public_ip(address) for address in addresses):
        raise ValueError("网页地址必须解析到公网 IP")
    return ResolvedTarget(
        url=value,
        hostname=hostname,
        port=port,
        addresses=addresses,
        host_header=_host_header(hostname, port, parsed.scheme),
    )


def resolve_model_target(base_url: str) -> ResolvedTarget:
    value = base_url.strip()
    parsed = urlsplit(value)
    if parsed.username or parsed.password:
        raise ValueError("base_url 不能包含用户名或密码")
    if parsed.query or parsed.fragment:
        raise ValueError("base_url 不能包含查询参数或片段")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError("base_url 缺少主机名")
    is_local = hostname in MODEL_LOCAL_HOSTS
    if parsed.scheme != "https" and not (parsed.scheme == "http" and is_local):
        raise ValueError("自定义模型仅允许公网 HTTPS 地址；HTTP 只允许 localhost 本地服务")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if is_local:
        addresses = _resolved_addresses(hostname, port, "base_url ")
        if any(not ipaddress.ip_address(address).is_loopback for address in addresses):
            raise ValueError("localhost 模型地址必须只解析到回环 IP")
        return ResolvedTarget(
            url=value.rstrip("/"),
            hostname=hostname,
            port=port,
            addresses=addresses,
            host_header=_host_header(hostname, port, parsed.scheme),
        )

    addresses = _resolved_addresses(hostname, port, "base_url ")
    blocked = next((address for address in addresses if not is_public_ip(address)), None)
    if blocked:
        raise ValueError(
            f"拒绝访问私网、回环、链路本地或保留地址 '{hostname}' ({blocked})，防止 SSRF 攻击。"
        )
    return ResolvedTarget(
        url=value.rstrip("/"),
        hostname=hostname,
        port=port,
        addresses=addresses,
        host_header=_host_header(hostname, port, parsed.scheme),
    )


def validate_public_url(url: str) -> str:
    return resolve_public_target(url).url


def validate_model_base_url(base_url: str) -> str:
    return resolve_model_target(base_url).url
