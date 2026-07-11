import socket
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from web_reader_policy import validate_public_url


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
                "web_reader_policy.socket.getaddrinfo",
                return_value=[(family, socket.SOCK_STREAM, 6, "", (address, 443))],
            ):
                with self.assertRaisesRegex(ValueError, "公网"):
                    validate_public_url("https://example.test/page")

    def test_accepts_https_when_every_resolved_address_is_public(self):
        with patch(
            "web_reader_policy.socket.getaddrinfo",
            return_value=[
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443)),
            ],
        ):
            self.assertEqual(
                validate_public_url("https://example.test/page"),
                "https://example.test/page",
            )


if __name__ == "__main__":
    unittest.main()
