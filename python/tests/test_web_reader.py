import json
import socket
import sys
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from web_reader_policy import validate_public_url
from web_reader import read_web_page

POLICY_CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "security" / "ssrf-policy-cases.json").read_text(
        encoding="utf-8"
    )
)


class PublicUrlPolicyTests(unittest.TestCase):
    def test_rejects_non_http_credentials_and_local_hosts(self):
        for url in [
            "file:///etc/passwd",
            "http://user:pass@example.com",
            "http://localhost/admin",
            "http://127.0.0.1/admin",
            "http://[::1]/admin",
        ]:
            with self.assertRaises(ValueError, msg=url):
                validate_public_url(url)

    def test_rejects_dns_that_resolves_to_private_or_link_local(self):
        for address in ["10.0.0.1", "192.168.1.10", "169.254.1.1", "::1"]:
            family = socket.AF_INET6 if ":" in address else socket.AF_INET
            with patch(
                "network_policy.socket.getaddrinfo",
                return_value=[(family, socket.SOCK_STREAM, 6, "", (address, 443))],
            ):
                with self.assertRaisesRegex(ValueError, "公网"):
                    validate_public_url("https://example.test/page")

    def test_accepts_https_when_every_resolved_address_is_public(self):
        with patch(
            "network_policy.socket.getaddrinfo",
            return_value=[
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443)),
            ],
        ):
            self.assertEqual(
                validate_public_url("https://example.test/page"),
                "https://example.test/page",
            )

    def test_matches_shared_public_url_policy_cases(self):
        for item in POLICY_CASES["publicUrls"]:
            address = item["resolvedIp"]
            family = socket.AF_INET6 if ":" in address else socket.AF_INET
            with self.subTest(url=item["url"], address=address), patch(
                "network_policy.socket.getaddrinfo",
                return_value=[(family, socket.SOCK_STREAM, 6, "", (address, 443))],
            ):
                if item["allowed"]:
                    self.assertEqual(validate_public_url(item["url"]), item["url"])
                else:
                    with self.assertRaises(ValueError):
                        validate_public_url(item["url"])

    def test_web_reader_uses_the_pinned_public_request_layer(self):
        response = Mock()
        response.is_redirect = False
        response.is_permanent_redirect = False
        response.headers = {"content-type": "text/plain"}
        response.encoding = "utf-8"
        response.iter_content.return_value = iter([b"safe content"])
        response.raise_for_status.return_value = None

        with patch(
            "web_reader.pinned_request",
            return_value=nullcontext(response),
        ) as request:
            result = read_web_page("https://example.test/page")

        self.assertEqual(result["text"], "safe content")
        self.assertEqual(request.call_args.args[:2], ("GET", "https://example.test/page"))
        self.assertEqual(request.call_args.kwargs["policy"], "public")


if __name__ == "__main__":
    unittest.main()
