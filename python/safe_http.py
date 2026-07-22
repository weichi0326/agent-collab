"""HTTP requests whose sockets are pinned to policy-validated IP addresses."""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Final, Literal
from urllib.parse import urlsplit

import requests
from requests import PreparedRequest, Response, Session
from requests.adapters import HTTPAdapter

from network_policy import resolve_model_target, resolve_public_target

PUBLIC_POLICY: Final = "public"
MODEL_POLICY: Final = "model"
RequestPolicy = Literal["public", "model"]


def _resolve_target(url: str, policy: RequestPolicy):
    if policy == PUBLIC_POLICY:
        return resolve_public_target(url)
    if policy == MODEL_POLICY:
        return resolve_model_target(url)
    raise ValueError(f"未知网络请求策略：{policy}")


class _PinnedHTTPAdapter(HTTPAdapter):
    def __init__(self, policy: RequestPolicy) -> None:
        super().__init__(max_retries=0)
        self._policy = policy

    def build_connection_pool_key_attributes(self, request, verify, cert=None):
        host_params, pool_kwargs = super().build_connection_pool_key_attributes(
            request,
            verify,
            cert,
        )
        pinned_ip = getattr(request, "_ssrf_pinned_ip", None)
        original_hostname = getattr(request, "_ssrf_original_hostname", None)
        if not pinned_ip or not original_hostname:
            raise requests.InvalidURL("安全请求缺少固定连接目标")
        host_params["host"] = pinned_ip
        if host_params["scheme"] == "https":
            pool_kwargs["server_hostname"] = original_hostname
            pool_kwargs["assert_hostname"] = original_hostname
        return host_params, pool_kwargs

    def send(
        self,
        request: PreparedRequest,
        stream: bool = False,
        timeout=None,
        verify=True,
        cert=None,
        proxies=None,
    ) -> Response:
        if proxies:
            raise ValueError("安全请求不允许使用代理")
        target = _resolve_target(request.url or "", self._policy)
        last_error: requests.RequestException | None = None
        for address in target.addresses:
            attempt = request.copy()
            setattr(attempt, "_ssrf_pinned_ip", address)
            setattr(attempt, "_ssrf_original_hostname", target.hostname)
            attempt.headers["Host"] = target.host_header
            try:
                return super().send(
                    attempt,
                    stream=stream,
                    timeout=timeout,
                    verify=verify,
                    cert=cert,
                    proxies={},
                )
            except (requests.ConnectionError, requests.Timeout) as exc:
                last_error = exc
        if last_error is not None:
            raise last_error
        raise requests.ConnectionError("安全请求没有可用的连接目标")


@contextmanager
def pinned_request(
    method: str,
    url: str,
    *,
    policy: RequestPolicy,
    **kwargs,
) -> Iterator[Response]:
    if kwargs.pop("allow_redirects", False):
        raise ValueError("安全请求不允许自动跟随重定向")
    if kwargs.pop("proxies", None):
        raise ValueError("安全请求不允许使用代理")
    if urlsplit(url).scheme == "https" and kwargs.get("verify", True) is False:
        raise ValueError("安全 HTTPS 请求不能关闭证书校验")

    session = Session()
    session.trust_env = False
    adapter = _PinnedHTTPAdapter(policy)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    response: Response | None = None
    try:
        response = session.request(
            method,
            url,
            allow_redirects=False,
            **kwargs,
        )
        yield response
    finally:
        if response is not None:
            response.close()
        session.close()
