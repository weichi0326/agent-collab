import unittest
import sys
from pathlib import Path
from unittest.mock import Mock, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import llm_calling


class LlmCallingRetryTests(unittest.TestCase):
    def test_public_custom_https_base_url_is_allowed(self):
        resolved = [(None, None, None, None, ("93.184.216.34", 443))]
        with patch.object(llm_calling.socket, "getaddrinfo", return_value=resolved):
            self.assertEqual(
                llm_calling._validate_base_url("https://trusted.example/v1"),
                "https://trusted.example/v1",
            )

    def test_allowlisted_base_url_is_allowed(self):
        resolved = [(None, None, None, None, ("8.8.8.8", 443))]
        with patch.object(llm_calling.socket, "getaddrinfo", return_value=resolved):
            self.assertEqual(
                llm_calling._validate_base_url("https://api.deepseek.com/v1"),
                "https://api.deepseek.com/v1",
            )

    def test_private_dns_result_and_public_http_are_rejected(self):
        resolved = [(None, None, None, None, ("10.0.0.8", 443))]
        with patch.object(llm_calling.socket, "getaddrinfo", return_value=resolved):
            with self.assertRaisesRegex(ValueError, "私网"):
                llm_calling._validate_base_url("https://internal.example/v1")
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            llm_calling._validate_base_url("http://public.example/v1")

    def test_explicit_localhost_service_is_allowed(self):
        self.assertEqual(
            llm_calling._validate_base_url("http://localhost:11434/v1"),
            "http://localhost:11434/v1",
        )

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

        with patch.object(llm_calling.requests, "post", side_effect=[first, second]) as post:
            result = llm_calling._post_json("https://example.test", {}, {})

        self.assertEqual(result, {"ok": True})
        self.assertEqual(post.call_count, 2)

    def test_non_json_response_becomes_runtime_error(self):
        response = Mock()
        response.status_code = 200
        response.raise_for_status.return_value = None
        response.json.side_effect = ValueError("not json")

        with patch.object(llm_calling.requests, "post", return_value=response):
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


if __name__ == "__main__":
    unittest.main()
