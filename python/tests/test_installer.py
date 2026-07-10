import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import installer, dynamic


VALID_CODE = (
    "from typing import Any\n"
    "async def execute(params: dict[str, Any]) -> Any:\n"
    "    return {'ok': True}\n"
)


class ValidateToolNameTests(unittest.TestCase):
    def test_valid_slug(self):
        self.assertEqual(installer.validate_tool_name("my-tool"), "my-tool")

    def test_rejects_uppercase_and_bad_start(self):
        for bad in ["MyTool", "1tool", "-tool", "a", "tool_name", "工具"]:
            with self.assertRaises(ValueError):
                installer.validate_tool_name(bad)

    def test_rejects_builtin_override(self):
        for name in dynamic.BUILTIN_NAMES:
            with self.assertRaisesRegex(ValueError, "内置工具冲突"):
                installer.validate_tool_name(name)


class ValidatePackageTests(unittest.TestCase):
    def test_valid_packages(self):
        for pkg in ["requests", "requests==2.31.0", "pandas>=2.0", "some_pkg[extra]"]:
            self.assertEqual(installer.validate_package(pkg), pkg)

    def test_rejects_injection_and_flags(self):
        for bad in ["-r req.txt", "--index-url http://x", "a; rm -rf /", "a b", "a`whoami`", ""]:
            with self.assertRaises(ValueError):
                installer.validate_package(bad)


class CompileCheckTests(unittest.TestCase):
    def test_valid_code_passes(self):
        installer.compile_check(VALID_CODE, "ok-tool")

    def test_rejects_syntax_error(self):
        with self.assertRaisesRegex(ValueError, "语法错误"):
            installer.compile_check("async def execute(:\n  pass", "bad")

    def test_rejects_missing_execute(self):
        with self.assertRaisesRegex(ValueError, "execute"):
            installer.compile_check("def other():\n  pass\n", "bad")

    def test_rejects_sync_execute(self):
        # 同步 def execute 不满足契约（需 async）
        with self.assertRaisesRegex(ValueError, "execute"):
            installer.compile_check("def execute(params):\n  return 1\n", "bad")

    def test_rejects_oversize(self):
        big = "x = 1\n" * (installer.MAX_CODE_SIZE)
        with self.assertRaisesRegex(ValueError, "上限"):
            installer.compile_check(big, "big")

    def test_rejects_empty(self):
        with self.assertRaises(ValueError):
            installer.compile_check("   ", "empty")


class InstallDependenciesTests(unittest.TestCase):
    def test_empty_returns_empty_without_pip(self):
        with patch.object(installer, "_run_pip_install") as pip:
            result = asyncio.run(installer.install_dependencies([]))
            self.assertEqual(result, [])
            pip.assert_not_called()

    def test_rejects_bad_package_before_pip(self):
        with patch.object(installer, "_run_pip_install") as pip:
            with self.assertRaises(ValueError):
                asyncio.run(installer.install_dependencies(["-r evil.txt"]))
            pip.assert_not_called()

    def test_validates_then_installs(self):
        with patch.object(installer, "_run_pip_install") as pip:
            result = asyncio.run(installer.install_dependencies(["requests"]))
            self.assertEqual(result, ["requests"])
            pip.assert_called_once_with(["requests"])


class RemoveToolTests(unittest.TestCase):
    def test_rejects_builtin(self):
        with self.assertRaisesRegex(ValueError, "内置工具"):
            installer.remove_tool("file-read", {})

    def test_rejects_unknown(self):
        with patch.object(dynamic, "read_registry", return_value=[]):
            with self.assertRaisesRegex(ValueError, "未找到"):
                installer.remove_tool("nope-tool", {})


class TopLevelSideEffectTests(unittest.TestCase):
    """顶层副作用硬门(check_top_level_side_effects / compile_check allow 位)。"""

    def _code(self, body: str) -> str:
        # 拼一段合法工具:给定 body 放在 execute 之外的顶层。
        return (
            "import os\n"
            "import re\n"
            "import logging\n"
            f"{body}\n"
            "async def execute(params):\n"
            "    return {'ok': True}\n"
        )

    def test_allows_imports_defs_assignments(self):
        # 顶层只有常量 / logger 赋值 / re.compile 赋值 → 放行(低误报)
        body = (
            "MAX = 10\n"
            "logger = logging.getLogger(__name__)\n"
            "_RE = re.compile(r'x')\n"
        )
        installer.compile_check(self._code(body), "ok-tool")  # 不抛即通过

    def test_allows_main_guard(self):
        body = 'if __name__ == "__main__":\n    pass'
        installer.compile_check(self._code(body), "guard-tool")

    def test_rejects_bare_top_level_call(self):
        # 顶层裸调用(结果丢弃=纯副作用),import 时就会跑
        for body in ["os.system('echo hi')", "print('boom')", "os.remove('x')"]:
            with self.assertRaisesRegex(ValueError, "顶层可执行副作用"):
                installer.compile_check(self._code(body), "bad-tool")

    def test_rejects_top_level_control_flow(self):
        for body in [
            "for i in range(3):\n    os.system('x')",
            "while True:\n    break",
            "with open('x') as f:\n    pass",
            "try:\n    os.remove('x')\nexcept Exception:\n    pass",
        ]:
            with self.assertRaisesRegex(ValueError, "顶层可执行副作用"):
                installer.compile_check(self._code(body), "bad-tool")

    def test_rejects_assignment_side_effect(self):
        # 赋值型副作用(B 类绕过):以前漏拦,现升级扫描右侧 Call 进白名单校验。
        for body in [
            "_ = os.system('echo hi')",
            "data = requests.get('http://evil')",
            "x = subprocess.run(['rm', '-rf', '/'])",
            "ret: int = os.system('x')",  # AnnAssign 同样要拦
        ]:
            with self.assertRaisesRegex(ValueError, "非白名单调用"):
                installer.compile_check(self._code(body), "bad-tool")

    def test_allows_safe_assignment_calls_only(self):
        # 白名单内的初始化调用放行:logger / re.compile / namedtuple / dataclass
        body = (
            "logger = logging.getLogger(__name__)\n"
            "POINT = collections.namedtuple('Point', ['x', 'y'])\n"
            "RE_NUM = re.compile(r'\\d+')\n"
        )
        installer.compile_check(self._code(body), "safe-tool")

    def test_rejects_nested_dangerous_in_safe_wrapper(self):
        # 即便外层是白名单函数,内层嵌危险调用也要拦(递归查所有 Call)
        body = "_ = re.compile(os.system('echo hi'))"  # 嵌套危险调用
        with self.assertRaisesRegex(ValueError, "非白名单调用"):
            installer.compile_check(self._code(body), "bad-tool")

    def test_allow_flag_overrides(self):
        # 桌面 UI 明确放行时,顶层副作用不再拦(但语法/execute/体积仍校验)
        body = "os.system('echo hi')"
        installer.compile_check(self._code(body), "ok-tool", allow_side_effects=True)

    def test_allow_flag_overrides_assignment(self):
        # 放行位也覆盖赋值型(B 类)
        body = "_ = os.system('echo hi')"
        installer.compile_check(self._code(body), "ok-tool", allow_side_effects=True)

    def test_missing_execute_still_rejected_regardless_of_flag(self):
        code = "import os\nMAX = 1\n"  # 无 execute
        with self.assertRaisesRegex(ValueError, "execute"):
            installer.compile_check(code, "no-exec", allow_side_effects=True)


if __name__ == "__main__":
    unittest.main()
