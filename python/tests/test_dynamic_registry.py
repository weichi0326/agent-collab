import json
import os
import shutil
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

    def test_migrates_legacy_user_tools_without_overwriting_user_data(self) -> None:
        legacy = Path(tempfile.mkdtemp(prefix="legacy_tools_test_"))
        target = Path(tempfile.mkdtemp(prefix="user_tools_test_"))
        self.addCleanup(lambda: shutil.rmtree(legacy, ignore_errors=True))
        self.addCleanup(lambda: shutil.rmtree(target, ignore_errors=True))

        (legacy / "legacy_tool.py").write_text("VALUE = 'legacy'", encoding="utf-8")
        (legacy / "registry.json").write_text(
            '[{"name":"legacy","module":"legacy_tool"}]',
            encoding="utf-8",
        )
        (legacy / "tool-audit.jsonl").write_text('{"name":"legacy"}\n', encoding="utf-8")
        (legacy / "__init__.py").write_text("# package", encoding="utf-8")
        (target / "registry.json").write_text(
            '[{"name":"current","module":"current_tool"}]',
            encoding="utf-8",
        )
        (target / "tool-audit.jsonl").write_text('{"name":"current"}\n', encoding="utf-8")

        with patch.object(dynamic, "LEGACY_CUSTOM_DIR", legacy), patch.object(
            dynamic, "CUSTOM_DIR", target
        ):
            migrated = dynamic.migrate_legacy_custom_tools()

        self.assertEqual(migrated, 3)
        self.assertEqual(
            (target / "legacy_tool.py").read_text(encoding="utf-8"),
            "VALUE = 'legacy'",
        )
        self.assertEqual(
            [entry["name"] for entry in json.loads((target / "registry.json").read_text(encoding="utf-8"))],
            ["current", "legacy"],
        )
        self.assertEqual(
            (target / "tool-audit.jsonl").read_text(encoding="utf-8"),
            '{"name":"legacy"}\n{"name":"current"}\n',
        )
        self.assertFalse((target / "__init__.py").exists())

        with patch.object(dynamic, "LEGACY_CUSTOM_DIR", legacy), patch.object(
            dynamic, "CUSTOM_DIR", target
        ):
            self.assertEqual(dynamic.migrate_legacy_custom_tools(), 0)


if __name__ == "__main__":
    unittest.main()
