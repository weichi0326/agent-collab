import asyncio
import base64
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import file_write


class FileWriteCountTests(unittest.TestCase):
    def test_reports_utf8_bytes_for_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp, "text.txt")
            with patch.object(file_write, "resolve_safe_path", return_value=target):
                result = asyncio.run(file_write.execute({"path": str(target), "content": "中文"}))

            self.assertEqual(result["written"], len("中文".encode("utf-8")))

    def test_reports_decoded_bytes_for_binary_base64(self) -> None:
        payload = b"\x00\x01\x02\xff"
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp, "binary.bin")
            with patch.object(file_write, "resolve_safe_path", return_value=target):
                result = asyncio.run(file_write.execute({
                    "path": str(target),
                    "content": base64.b64encode(payload).decode("ascii"),
                    "binary_b64": True,
                }))

            self.assertEqual(result["written"], len(payload))
            self.assertEqual(target.read_bytes(), payload)


if __name__ == "__main__":
    unittest.main()
