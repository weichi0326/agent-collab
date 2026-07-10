import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import dynamic


class DynamicRegistryWriteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.mkdtemp(prefix="dynamic_registry_test_")
        self.addCleanup(self._cleanup)

    def _cleanup(self) -> None:
        for entry in os.listdir(self.tmpdir):
            full = os.path.join(self.tmpdir, entry)
            try:
                os.unlink(full)
            except OSError:
                pass
        os.rmdir(self.tmpdir)

    def test_write_registry_uses_atomic_write_and_utf8_json(self) -> None:
        custom_dir = Path(self.tmpdir)
        registry_path = custom_dir / "registry.json"
        entries = [
            {
                "name": "api-tester",
                "module": "api_tester",
                "description": "接口测试工具",
            }
        ]

        real_atomic = dynamic.atomic_write_bytes
        with patch.object(dynamic, "CUSTOM_DIR", custom_dir), patch.object(
            dynamic, "REGISTRY_PATH", registry_path
        ), patch.object(dynamic, "atomic_write_bytes", wraps=real_atomic) as atomic:
            dynamic.write_registry(entries)

        atomic.assert_called_once()
        self.assertEqual(atomic.call_args.args[0], registry_path)
        self.assertEqual(json.loads(registry_path.read_text(encoding="utf-8")), entries)


if __name__ == "__main__":
    unittest.main()