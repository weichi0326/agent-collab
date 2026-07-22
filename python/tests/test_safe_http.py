import socket
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import requests
from requests import Response
from requests.adapters import HTTPAdapter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from safe_http import MODEL_POLICY, PUBLIC_POLICY, pinned_request


def resolved(*addresses: str, port: int = 443):
    return [
        (
            socket.AF_INET6 if ":" in address else socket.AF_INET,
            socket.SOCK_STREAM,
            socket.IPPROTO_TCP,
            "",
            (address, port),
        )
        for address in addresses
    ]


class PinnedRequestTests(unittest.TestCase):
    def test_real_local_connection_preserves_the_original_host_header(self):
        received_hosts = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                received_hosts.append(self.headers.get("Host"))
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"ok")

            def log_message(self, _format, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_address[1]
            with pinned_request(
                "GET",
                f"http://localhost:{port}/health",
                policy=MODEL_POLICY,
                timeout=2,
            ) as response:
                self.assertEqual(response.text, "ok")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertEqual(received_hosts, [f"localhost:{port}"])

    def test_https_connection_uses_validated_ip_with_original_tls_identity(self):
        attempts = []

        def fake_send(adapter, request, **kwargs):
            host_params, pool_kwargs = adapter.build_connection_pool_key_attributes(
                request,
                kwargs.get("verify", True),
                kwargs.get("cert"),
            )
            attempts.append((host_params, pool_kwargs, dict(request.headers)))
            response = Response()
            response.status_code = 200
            response._content = b"ok"
            response.request = request
            response.url = request.url
            return response

        dns_results = [
            resolved("93.184.216.34"),
            resolved("127.0.0.1"),
        ]
        with patch("network_policy.socket.getaddrinfo", side_effect=dns_results) as lookup, patch.object(
            HTTPAdapter,
            "send",
            new=fake_send,
        ):
            with pinned_request(
                "GET",
                "https://example.test/path",
                policy=PUBLIC_POLICY,
            ) as response:
                self.assertEqual(response.url, "https://example.test/path")

        self.assertEqual(lookup.call_count, 1)
        host_params, pool_kwargs, headers = attempts[0]
        self.assertEqual(host_params["host"], "93.184.216.34")
        self.assertEqual(headers["Host"], "example.test")
        self.assertEqual(pool_kwargs["server_hostname"], "example.test")
        self.assertEqual(pool_kwargs["assert_hostname"], "example.test")

    def test_rejects_mixed_public_and_private_dns_answers_before_connecting(self):
        with patch(
            "network_policy.socket.getaddrinfo",
            return_value=resolved("93.184.216.34", "10.0.0.8"),
        ), patch.object(HTTPAdapter, "send") as send:
            with self.assertRaisesRegex(ValueError, "公网"):
                with pinned_request(
                    "GET",
                    "https://example.test/path",
                    policy=PUBLIC_POLICY,
                ):
                    pass

        send.assert_not_called()

    def test_retries_the_next_validated_address_without_resolving_again(self):
        attempted_hosts = []

        def fake_send(adapter, request, **kwargs):
            host_params, _ = adapter.build_connection_pool_key_attributes(
                request,
                kwargs.get("verify", True),
                kwargs.get("cert"),
            )
            attempted_hosts.append(host_params["host"])
            if len(attempted_hosts) == 1:
                raise requests.ConnectionError("first address unavailable")
            response = Response()
            response.status_code = 200
            response._content = b"ok"
            response.request = request
            response.url = request.url
            return response

        with patch(
            "network_policy.socket.getaddrinfo",
            return_value=resolved("93.184.216.34", "93.184.216.35"),
        ) as lookup, patch.object(HTTPAdapter, "send", new=fake_send):
            with pinned_request(
                "GET",
                "https://example.test/path",
                policy=PUBLIC_POLICY,
            ) as response:
                self.assertEqual(response.status_code, 200)

        self.assertEqual(lookup.call_count, 1)
        self.assertEqual(attempted_hosts, ["93.184.216.34", "93.184.216.35"])

    def test_model_localhost_is_pinned_to_loopback_only(self):
        attempts = []

        def fake_send(adapter, request, **kwargs):
            host_params, _ = adapter.build_connection_pool_key_attributes(
                request,
                kwargs.get("verify", True),
                kwargs.get("cert"),
            )
            attempts.append((host_params, dict(request.headers)))
            response = Response()
            response.status_code = 200
            response._content = b"ok"
            response.request = request
            response.url = request.url
            return response

        with patch(
            "network_policy.socket.getaddrinfo",
            return_value=resolved("127.0.0.1", port=11434),
        ), patch.object(HTTPAdapter, "send", new=fake_send):
            with pinned_request(
                "POST",
                "http://localhost:11434/v1/chat/completions",
                policy=MODEL_POLICY,
            ):
                pass

        self.assertEqual(attempts[0][0]["host"], "127.0.0.1")
        self.assertEqual(attempts[0][1]["Host"], "localhost:11434")

        with patch(
            "network_policy.socket.getaddrinfo",
            return_value=resolved("127.0.0.1", "8.8.8.8", port=11434),
        ), patch.object(HTTPAdapter, "send") as send:
            with self.assertRaisesRegex(ValueError, "回环"):
                with pinned_request(
                    "POST",
                    "http://localhost:11434/v1/chat/completions",
                    policy=MODEL_POLICY,
                ):
                    pass
            send.assert_not_called()

    def test_rejects_redirect_following_and_explicit_proxies(self):
        with self.assertRaisesRegex(ValueError, "重定向"):
            with pinned_request(
                "GET",
                "https://example.test",
                policy=PUBLIC_POLICY,
                allow_redirects=True,
            ):
                pass

        with self.assertRaisesRegex(ValueError, "代理"):
            with pinned_request(
                "GET",
                "https://example.test",
                policy=PUBLIC_POLICY,
                proxies={"https": "http://proxy.test:8080"},
            ):
                pass


if __name__ == "__main__":
    unittest.main()
