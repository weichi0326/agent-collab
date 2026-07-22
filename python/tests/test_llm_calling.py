import asyncio
import ipaddress
import json
import socket
import unittest
import sys
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import urlsplit

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import llm_calling

POLICY_CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "security" / "ssrf-policy-cases.json").read_text(
        encoding="utf-8"
    )
)


class LlmCallingRetryTests(unittest.TestCase):
    def test_public_custom_https_base_url_is_allowed(self):
        resolved = [(None, None, None, None, ("93.184.216.34", 443))]
        with patch("network_policy.socket.getaddrinfo", return_value=resolved):
            self.assertEqual(
                llm_calling._validate_base_url("https://trusted.example/v1"),
                "https://trusted.example/v1",
            )

    def test_allowlisted_base_url_is_allowed(self):
        resolved = [(None, None, None, None, ("8.8.8.8", 443))]
        with patch("network_policy.socket.getaddrinfo", return_value=resolved):
            self.assertEqual(
                llm_calling._validate_base_url("https://api.deepseek.com/v1"),
                "https://api.deepseek.com/v1",
            )

    def test_private_dns_result_and_public_http_are_rejected(self):
        resolved = [(None, None, None, None, ("10.0.0.8", 443))]
        with patch("network_policy.socket.getaddrinfo", return_value=resolved):
            with self.assertRaisesRegex(ValueError, "私网"):
                llm_calling._validate_base_url("https://internal.example/v1")
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            llm_calling._validate_base_url("http://public.example/v1")

    def test_explicit_localhost_service_is_allowed(self):
        self.assertEqual(
            llm_calling._validate_base_url("http://localhost:11434/v1"),
            "http://localhost:11434/v1",
        )

    def test_matches_shared_model_endpoint_policy_cases(self):
        for item in POLICY_CASES["modelBaseUrls"]:
            hostname = urlsplit(item["url"]).hostname or ""
            try:
                address = str(ipaddress.ip_address(hostname))
            except ValueError:
                address = "127.0.0.1" if hostname == "localhost" else "93.184.216.34"
            family = socket.AF_INET6 if ":" in address else socket.AF_INET
            with self.subTest(url=item["url"]), patch(
                "network_policy.socket.getaddrinfo",
                return_value=[(family, 1, 6, "", (address, 443))],
            ):
                if item["allowed"]:
                    self.assertEqual(
                        llm_calling._validate_base_url(item["url"]),
                        item["url"].rstrip("/"),
                    )
                else:
                    with self.assertRaises(ValueError):
                        llm_calling._validate_base_url(item["url"])

    def test_chunked_encoding_error_is_transient(self):
        exc = requests.exceptions.ChunkedEncodingError("Response ended prematurely")
        self.assertTrue(llm_calling._is_transient_error(exc))

    def test_timeout_and_connection_reset_are_transient(self):
        self.assertTrue(llm_calling._is_transient_error(requests.Timeout("read timed out")))
        self.assertTrue(
            llm_calling._is_transient_error(
                requests.ConnectionError("connection reset by peer"),
            ),
        )

    def test_http_429_is_retried(self):
        first = Mock()
        first.status_code = 429
        first.headers = {"retry-after": "0"}
        first.raise_for_status.side_effect = requests.HTTPError(response=first)

        second = Mock()
        second.status_code = 200
        second.raise_for_status.return_value = None
        second.json.return_value = {"ok": True}

        with patch.object(
            llm_calling,
            "pinned_request",
            side_effect=[nullcontext(first), nullcontext(second)],
        ) as post:
            result = llm_calling._post_json("https://example.test", {}, {})

        self.assertEqual(result, {"ok": True})
        self.assertEqual(post.call_count, 2)

    def test_non_json_response_becomes_runtime_error(self):
        response = Mock()
        response.status_code = 200
        response.raise_for_status.return_value = None
        response.json.side_effect = ValueError("not json")

        with patch.object(
            llm_calling,
            "pinned_request",
            return_value=nullcontext(response),
        ):
            with self.assertRaisesRegex(RuntimeError, "LLM 返回内容不是合法 JSON"):
                llm_calling._post_json("https://example.test", {}, {})

    def test_openai_request_includes_optional_temperature(self):
        response = {
            "choices": [{"message": {"content": "ok"}}],
            "usage": {"total_tokens": 3},
        }
        with patch.object(llm_calling, "_post_json", return_value=response) as post:
            result = llm_calling._call_openai(
                "https://example.test/v1", "key", "model", [], 8192, 0.4,
            )
        self.assertEqual(result, ("ok", 3))
        self.assertEqual(post.call_args.kwargs["payload"]["temperature"], 0.4)

    def test_anthropic_request_includes_optional_temperature(self):
        response = {
            "content": [{"type": "text", "text": "ok"}],
            "usage": {"input_tokens": 2, "output_tokens": 1},
        }
        with patch.object(llm_calling, "_post_json", return_value=response) as post:
            result = llm_calling._call_anthropic(
                "https://example.test/v1", "key", "model", None, [], 8192, 0.4,
            )
        self.assertEqual(result, ("ok", 3))
        self.assertEqual(post.call_args.kwargs["payload"]["temperature"], 0.4)

    def test_list_models_uses_pinned_get_and_anthropic_headers(self):
        response = Mock()
        response.status_code = 200
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "data": [{"id": "claude-a"}, {"name": "claude-b"}],
        }

        with patch.object(
            llm_calling,
            "pinned_request",
            return_value=nullcontext(response),
        ) as request:
            result = llm_calling._list_models(
                "https://api.example.test/v1", "key", "anthropic",
            )

        self.assertEqual(result, ["claude-a", "claude-b"])
        request.assert_called_once_with(
            "GET",
            "https://api.example.test/v1/models",
            policy=llm_calling.MODEL_POLICY,
            headers={
                "x-api-key": "key",
                "anthropic-version": "2023-06-01",
                "Accept-Encoding": "identity",
            },
            timeout=(llm_calling.CONNECT_TIMEOUT, llm_calling.TIMEOUT),
        )

    def test_list_models_action_does_not_require_chat_fields(self):
        with patch.object(
            llm_calling,
            "_validate_base_url",
            return_value="https://api.example.test/v1",
        ), patch.object(
            llm_calling,
            "_list_models",
            return_value=["model-a", "model-b"],
        ):
            result = asyncio.run(llm_calling.execute({
                "action": "list_models",
                "api": "openai",
                "base_url": "https://api.example.test/v1",
                "api_key": "key",
            }))

        self.assertEqual(result, {"models": ["model-a", "model-b"]})

    def test_chat_preserves_the_frontend_max_token_limit(self):
        with patch.object(
            llm_calling,
            "_validate_base_url",
            return_value="https://api.example.test/v1",
        ), patch.object(
            llm_calling,
            "_call_openai",
            return_value=("ok", 1),
        ) as call:
            asyncio.run(llm_calling.execute({
                "api": "openai",
                "base_url": "https://api.example.test/v1",
                "api_key": "key",
                "model": "model-a",
                "messages": [{"role": "user", "content": "hello"}],
                "max_tokens": 30_000,
            }))

        self.assertEqual(call.call_args.args[4], 30_000)


if __name__ == "__main__":
    unittest.main()
