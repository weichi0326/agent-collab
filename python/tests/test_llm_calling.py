import unittest
import sys
from pathlib import Path
from unittest.mock import Mock, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import llm_calling


class LlmCallingRetryTests(unittest.TestCase):
    def test_public_non_allowlisted_base_url_is_rejected(self):
        with patch.object(llm_calling.socket, "gethostbyname", return_value="93.184.216.34"):
            with self.assertRaisesRegex(ValueError, "不在允许列表"):
                llm_calling._validate_base_url("https://attacker.example/v1")

    def test_allowlisted_base_url_is_allowed(self):
        self.assertEqual(
            llm_calling._validate_base_url("https://api.deepseek.com/v1"),
            "https://api.deepseek.com/v1",
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
        second.raise_for_status.return_value = None
        second.json.return_value = {"ok": True}

        with patch.object(llm_calling.requests, "post", side_effect=[first, second]) as post:
            result = llm_calling._post_json("https://example.test", {}, {})

        self.assertEqual(result, {"ok": True})
        self.assertEqual(post.call_count, 2)

    def test_non_json_response_becomes_runtime_error(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.side_effect = ValueError("not json")

        with patch.object(llm_calling.requests, "post", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "LLM 返回内容不是合法 JSON"):
                llm_calling._post_json("https://example.test", {}, {})


if __name__ == "__main__":
    unittest.main()
