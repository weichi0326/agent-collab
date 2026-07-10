"""P2-2 回归测试:收紧 allow_top_level_side_effects + 安装审计日志。

- 放行顶层副作用但缺 approval(approved_by/reason)→ 拒装(ValueError),不落盘、不写审计。
- 放行副作用且带完整 approval → 安装成功,审计记录含 approved_by/reason/allow/sha256/excerpt。
- 普通安装(不放行)→ 审计记录 approved_by 按来源兜底(generated→jizi-auto)。
- 审计封顶 MAX_AUDIT_RECORDS,超出丢最旧。
"""
import asyncio
import hashlib
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import installer, dynamic


SAFE_CODE = (
    "from typing import Any\n"
    "async def execute(params: dict[str, Any]) -> Any:\n"
    "    return {'ok': True}\n"
)
# 顶层裸调用 = 副作用,不放行时会被硬门拒绝。
SIDE_EFFECT_CODE = (
    "print('top level side effect')\n"
    "async def execute(params):\n"
    "    return 1\n"
)


def _payload(name, code, allow=False, approval=None, source="generated"):
    p = {
        "name": name,
        "description": "t",
        "dependencies": [],
        "code": code,
        "source": source,
        "allow_top_level_side_effects": allow,
    }
    if approval is not None:
        p["approval"] = approval
    return p


class InstallAuditTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = Path(tempfile.mkdtemp(prefix="install_audit_test_"))
        self.addCleanup(lambda: shutil.rmtree(self.tmpdir, ignore_errors=True))
        self.audit = self.tmpdir / "tool-audit.jsonl"
        self._patchers = [
            patch.object(dynamic, "CUSTOM_DIR", self.tmpdir),
            patch.object(dynamic, "AUDIT_PATH", self.audit),
            patch.object(dynamic, "read_registry", return_value=[]),
            patch.object(dynamic, "write_registry"),
        ]
        for p in self._patchers:
            p.start()
            self.addCleanup(p.stop)

    def test_allow_side_effects_without_approval_rejected(self) -> None:
        registry: dict = {}
        with self.assertRaises(ValueError):
            asyncio.run(
                installer.install_tool(
                    _payload("danger", SIDE_EFFECT_CODE, allow=True), registry
                )
            )
        # 未落盘、未写审计
        self.assertNotIn("danger", registry)
        self.assertFalse((self.tmpdir / "danger.py").exists())
        self.assertEqual(dynamic.read_audit_log(), [])

    def test_allow_side_effects_with_approval_records_audit(self) -> None:
        registry: dict = {}
        approval = {"approved_by": "alice", "reason": "需要顶层初始化连接池"}
        asyncio.run(
            installer.install_tool(
                _payload("with-approval", SIDE_EFFECT_CODE, allow=True, approval=approval),
                registry,
            )
        )
        self.assertIn("with-approval", registry)
        records = dynamic.read_audit_log()
        self.assertEqual(len(records), 1)
        rec = records[0]
        self.assertEqual(rec["name"], "with-approval")
        self.assertEqual(rec["approved_by"], "alice")
        self.assertEqual(rec["reason"], "需要顶层初始化连接池")
        self.assertTrue(rec["allow_side_effects"])
        self.assertEqual(
            rec["code_sha256"], hashlib.sha256(SIDE_EFFECT_CODE.encode("utf-8")).hexdigest()
        )
        self.assertIn("top level side effect", rec["code_excerpt"])

    def test_normal_install_defaults_approver_by_source(self) -> None:
        registry: dict = {}
        asyncio.run(installer.install_tool(_payload("plain", SAFE_CODE), registry))
        records = dynamic.read_audit_log()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["approved_by"], "jizi-auto")
        self.assertFalse(records[0]["allow_side_effects"])

    def test_audit_log_capped(self) -> None:
        with patch.object(dynamic, "MAX_AUDIT_RECORDS", 3):
            for i in range(5):
                dynamic.append_audit_record({"ts": i, "name": f"t{i}"})
        records = dynamic.read_audit_log()
        self.assertEqual([r["ts"] for r in records], [2, 3, 4])  # 只留最近 3 条


if __name__ == "__main__":
    unittest.main()
