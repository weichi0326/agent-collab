import asyncio
import importlib.util
import sys
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if importlib.util.find_spec("tools.custom.api_tester") is None:
    raise unittest.SkipTest("本地运行时未安装 api-tester")

from tools.custom import api_tester


def response(
    *,
    status: int = 200,
    headers: dict[str, str] | None = None,
    chunks: list[bytes] | None = None,
) -> Mock:
    result = Mock()
    result.status_code = status
    result.headers = headers or {"Content-Type": "text/plain"}
    result.encoding = "utf-8"
    result.iter_content.return_value = iter(chunks or [b"ok"])
    return result


class ApiTesterSafetyTests(unittest.TestCase):
    def test_rejects_private_url_before_sending_request(self) -> None:
        with patch.object(api_tester, "pinned_request") as request:
            with self.assertRaisesRegex(ValueError, "公网"):
                asyncio.run(api_tester.execute({"url": "http://127.0.0.1/admin"}))

        request.assert_not_called()

    def test_disables_and_rejects_redirects(self) -> None:
        redirected = response(status=302, headers={"Location": "http://127.0.0.1/admin"})
        with patch.object(
            api_tester,
            "validate_public_url",
            return_value="https://example.test/start",
        ), patch.object(
            api_tester,
            "pinned_request",
            return_value=nullcontext(redirected),
        ) as request:
            with self.assertRaisesRegex(ValueError, "重定向"):
                asyncio.run(api_tester.execute({"url": "https://example.test/start"}))

        self.assertEqual(request.call_args.kwargs["policy"], "public")
        self.assertTrue(request.call_args.kwargs["stream"])

    def test_rejects_response_body_above_limit(self) -> None:
        oversized = response(chunks=[b"x" * (api_tester.MAX_RESPONSE_BYTES + 1)])
        with patch.object(
            api_tester,
            "validate_public_url",
            return_value="https://example.test/data",
        ), patch.object(
            api_tester,
            "pinned_request",
            return_value=nullcontext(oversized),
        ):
            with self.assertRaisesRegex(ValueError, "响应体超过"):
                asyncio.run(api_tester.execute({"url": "https://example.test/data"}))

    def test_returns_bounded_decoded_body_and_json(self) -> None:
        ok = response(
            headers={"Content-Type": "application/json", "X-Test": "yes"},
            chunks=[b'{"value":', b" 42}"],
        )
        with patch.object(
            api_tester,
            "validate_public_url",
            return_value="https://example.test/data",
        ), patch.object(
            api_tester,
            "pinned_request",
            return_value=nullcontext(ok),
        ):
            result = asyncio.run(api_tester.execute({"url": "https://example.test/data"}))

        self.assertEqual(result["body"], '{"value": 42}')
        self.assertEqual(result["json"], {"value": 42})
        self.assertEqual(result["headers"]["X-Test"], "yes")


if __name__ == "__main__":
    unittest.main()
