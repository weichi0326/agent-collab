"""P0-1 / P1-3 回归测试：

- 覆盖安装失败（pip 失败 / 模块导入失败）时，旧模块文件、registry、内存注册项均不变；
  安装成功时才用新代码原子替换旧文件。
- 安装校验期间目标模块顶层恰好执行一次（不再 import 后立刻无条件 reload）。
- dynamic.load_custom_tools 在新进程首次加载时，模块顶层也恰好执行一次。
"""
import asyncio
import importlib
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import installer, dynamic


OLD_CODE = (
    "from typing import Any\n"
    "async def execute(params: dict[str, Any]) -> Any:\n"
    "    return {'v': 'old'}\n"
)
NEW_CODE = (
    "from typing import Any\n"
    "async def execute(params: dict[str, Any]) -> Any:\n"
    "    return {'v': 'new'}\n"
)
# 语法/契约合法，但 import 时会因导入不存在的模块而失败（compile_check 不执行 import，能过）。
IMPORT_FAILS_CODE = (
    "import definitely_not_a_real_module_zzz\n"
    "async def execute(params):\n"
    "    return 1\n"
)


def _payload(name: str, code: str, deps=None, allow=False) -> dict:
    p = {
        "name": name,
        "description": "t",
        "dependencies": deps or [],
        "code": code,
        "source": "generated",
        "allow_top_level_side_effects": allow,
    }
    # 放行副作用现在必须带审批(installer 收紧后的硬要求),否则拒装。
    if allow:
        p["approval"] = {"approved_by": "test", "reason": "单测放行顶层副作用"}
    return p


class InstallAtomicRollbackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = Path(tempfile.mkdtemp(prefix="install_atomic_test_"))
        self.addCleanup(lambda: shutil.rmtree(self.tmpdir, ignore_errors=True))
        # 把自定义工具目录指向临时目录，绝不碰真实 tools/custom。
        self._patchers = [
            patch.object(dynamic, "CUSTOM_DIR", self.tmpdir),
            patch.object(dynamic, "read_registry", return_value=[]),
            patch.object(dynamic, "write_registry"),
        ]
        for p in self._patchers:
            p.start()
            self.addCleanup(p.stop)

    def _write_old(self, name: str) -> Path:
        module_path = self.tmpdir / f"{installer._module_name(name)}.py"
        module_path.write_text(OLD_CODE, encoding="utf-8")
        return module_path

    def _leftover_tmp(self) -> list[str]:
        return [f for f in os.listdir(self.tmpdir) if f.endswith(".tmp")]

    def test_import_failure_preserves_old_file_and_registry(self) -> None:
        module_path = self._write_old("foo")
        registry = {"foo": "OLD_FN_SENTINEL"}

        with self.assertRaises(ValueError):
            asyncio.run(installer.install_tool(_payload("foo", IMPORT_FAILS_CODE), registry))

        # 旧文件内容原样保留
        self.assertEqual(module_path.read_text(encoding="utf-8"), OLD_CODE)
        # 内存注册项未被覆盖
        self.assertEqual(registry["foo"], "OLD_FN_SENTINEL")
        # 无临时文件残留
        self.assertEqual(self._leftover_tmp(), [])

    def test_pip_failure_preserves_old_file_and_registry(self) -> None:
        module_path = self._write_old("foo")
        registry = {"foo": "OLD_FN_SENTINEL"}

        def boom(_pkgs):
            raise RuntimeError("pip 挂了")

        with patch.object(installer, "_run_pip_install", side_effect=boom):
            with self.assertRaises(RuntimeError):
                asyncio.run(
                    installer.install_tool(_payload("foo", NEW_CODE, deps=["requests"]), registry)
                )

        self.assertEqual(module_path.read_text(encoding="utf-8"), OLD_CODE)
        self.assertEqual(registry["foo"], "OLD_FN_SENTINEL")
        self.assertEqual(self._leftover_tmp(), [])

    def test_success_atomically_replaces_and_registers(self) -> None:
        module_path = self._write_old("foo")
        registry = {"foo": "OLD_FN_SENTINEL"}

        entry = asyncio.run(installer.install_tool(_payload("foo", NEW_CODE), registry))

        self.assertEqual(module_path.read_text(encoding="utf-8"), NEW_CODE)
        self.assertTrue(callable(registry["foo"]))
        self.assertEqual(asyncio.run(registry["foo"]({})), {"v": "new"})
        self.assertEqual(entry["name"], "foo")
        self.assertEqual(self._leftover_tmp(), [])

    def test_install_executes_top_level_exactly_once(self) -> None:
        # 顶层副作用需放行位；用累加文件计执行次数。
        counter = self.tmpdir / "exec_count.txt"
        code = (
            "import pathlib\n"
            f"_f = pathlib.Path(r'{counter}').open('a', encoding='utf-8')\n"
            "_f.write('1'); _f.close()\n"
            "async def execute(params):\n"
            "    return 1\n"
        )
        registry: dict = {}
        asyncio.run(installer.install_tool(_payload("counter-tool", code, allow=True), registry))

        self.assertTrue(counter.exists())
        self.assertEqual(counter.read_text(encoding="utf-8"), "1")  # 恰好一次
        self.assertEqual(self._leftover_tmp(), [])


class LoadCustomToolsImportOnceTests(unittest.TestCase):
    """load_custom_tools 首次加载时模块顶层恰好执行一次（新进程语义）。"""

    def test_startup_import_runs_top_level_once(self) -> None:
        real_custom = dynamic.CUSTOM_DIR
        counter = Path(tempfile.mkdtemp(prefix="load_once_test_")) / "count.txt"
        self.addCleanup(lambda: shutil.rmtree(counter.parent, ignore_errors=True))

        module = f"_test_importonce_{int(time.time() * 1000)}"
        module_file = real_custom / f"{module}.py"
        code = (
            "import pathlib\n"
            f"_f = pathlib.Path(r'{counter}').open('a', encoding='utf-8')\n"
            "_f.write('1'); _f.close()\n"
            "async def execute(params):\n"
            "    return 1\n"
        )
        module_file.write_text(code, encoding="utf-8")
        module_key = f"tools.custom.{module}"

        def cleanup():
            try:
                module_file.unlink()
            except OSError:
                pass
            sys.modules.pop(module_key, None)

        self.addCleanup(cleanup)
        # 确保是「新进程首次加载」语义
        sys.modules.pop(module_key, None)

        entry = {"name": module.replace("_", "-"), "module": module}
        registry: dict = {}
        with patch.object(dynamic, "read_registry", return_value=[entry]):
            dynamic.load_custom_tools(registry)

        self.assertTrue(counter.exists())
        self.assertEqual(counter.read_text(encoding="utf-8"), "1")  # 只执行一次，不再 import+reload
        self.assertIn(entry["name"], registry)
        self.assertTrue(callable(registry[entry["name"]]))


if __name__ == "__main__":
    unittest.main()
