"""
工具安装器：校验 → 落盘 → 装依赖 → 动态注册；以及删除自定义工具。

安全护栏（本模块承载的硬底线）：
- 工具名 slug 白名单，禁止覆盖内置工具。
- 依赖包名逐个正则白名单，拒绝参数注入；pip 用 arg 列表（非 shell=True）+ 超时。
- 代码 compile() 语法校验 + 强制存在顶层 async def execute + 体积上限。
- install_tool 先在临时文件+隔离模块名下校验，成功才 os.replace 原子提交；
  失败绝不覆盖已有同名工具、不写 registry，不留半成品。

注意：调用方（router/姬子确认流程）必须已完成「人工审阅完整代码」这一步；
本模块不负责审阅，只负责在确认后安全落地。
"""
import ast
import asyncio
import hashlib
import importlib
import importlib.util
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from tools import dynamic

# 工具名：小写字母开头，字母/数字/连字符，长度 2~40。
_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{1,39}$")
# 依赖包名：PEP 508 简化版，允许可选 ==版本 / >= 等；不含空格/分号/参数前缀。
_PACKAGE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?([=<>!~]=?[\w.]+)?$")

MAX_CODE_SIZE = 20 * 1024  # 20KB
PIP_TIMEOUT = 180  # 秒
MAX_DEPENDENCIES = 20
MAX_CAPABILITIES = 12


def validate_tool_name(name: str) -> str:
    """校验工具名 slug；返回规范化后的名字。非法或与内置冲突则 raise ValueError。"""
    if not isinstance(name, str) or not _NAME_RE.match(name):
        raise ValueError(
            "工具名不合法：需以小写字母开头，仅含小写字母/数字/连字符，长度 2~40。"
        )
    if name in dynamic.BUILTIN_NAMES:
        raise ValueError(f"工具名 '{name}' 与内置工具冲突，请换一个名字。")
    return name


def _module_name(tool_name: str) -> str:
    """工具名 → Python 模块名（连字符转下划线，合法标识符）。"""
    return tool_name.replace("-", "_")


def validate_package(pkg: str) -> str:
    """校验单个依赖包名，防命令注入。返回原串。非法则 raise ValueError。"""
    if not isinstance(pkg, str):
        raise ValueError("依赖项必须是字符串")
    p = pkg.strip()
    if not p:
        raise ValueError("依赖项不能为空")
    if p.startswith("-") or any(c in p for c in " ;&|`$\n\r\t"):
        raise ValueError(f"依赖项 '{pkg}' 含非法字符或参数前缀，已拒绝。")
    if not _PACKAGE_RE.match(p):
        raise ValueError(
            f"依赖项 '{pkg}' 格式不合法。仅允许 requirements 风格，如 requests 或 requests==2.31.0。"
        )
    return p


def _is_main_guard(node: ast.stmt) -> bool:
    """判断是否 `if __name__ == "__main__":` 守卫(import 时不执行,安全放行)。"""
    if not isinstance(node, ast.If):
        return False
    test = node.test
    return (
        isinstance(test, ast.Compare)
        and isinstance(test.left, ast.Name)
        and test.left.id == "__name__"
        and len(test.comparators) == 1
        and isinstance(test.comparators[0], ast.Constant)
        and test.comparators[0].value == "__main__"
    )


# 赋值右侧允许调用的白名单:典型「import 期的无害基础设施初始化」。
# 形如 (<module>, <func>) 完全限定名;匹配走 _allowed_call_name。
_ASSIGN_SAFE_CALLS = {
    ("logging", "getLogger"),
    ("re", "compile"),
    ("collections", "namedtuple"),
    ("dataclasses", "dataclass"),
    ("enum", "Enum"),
    ("pathlib", "Path"),
    ("decimal", "Decimal"),
    ("datetime", "datetime"),
    ("datetime", "date"),
    ("datetime", "time"),
    ("datetime", "timedelta"),
}


def _call_qualname(node: ast.Call) -> str | None:
    """识别调用形如 `module.func(...)` / `func(...)`,返回 `module.func` / `func` 全限定串。"""
    fn = node.func
    if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name):
        return f"{fn.value.id}.{fn.attr}"
    if isinstance(fn, ast.Name):
        return fn.id
    return None


def _walk_node_with_call(node: ast.AST):
    """递归遍历表达式里的所有 Call 节点(包括赋值右侧、嵌套调用、列表推导等)。"""
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            yield child


def _walk_call_in_stmt(stmt: ast.stmt):
    """对顶层语句递归找所有 Call——但只遍历「会执行的副作用位」,避开 def/class 内部体。"""
    for child in ast.walk(stmt):
        if isinstance(child, ast.Call):
            yield child


def check_top_level_side_effects(tree: ast.Module) -> None:
    """扫描模块顶层,拒绝「import 时会执行工作」的副作用。硬门(installer 端,非前端)。

    允许:import / 函数或类定义 / docstring / pass / __main__ 守卫 /
    顶层赋值(但赋值右侧若含 Call 则走白名单,只放 logger=getLogger/re.compile 这类无害初始化)。
    拒绝:裸调用表达式(结果丢弃=纯副作用,如 os.system(...)) /
    顶层赋值含非白名单调用(如 _ = os.system('rm -rf /')) /
    顶层循环 / with / try / 非守卫 if(import 时会真跑)。
    """
    allowed_plain = (
        ast.Import,
        ast.ImportFrom,
        ast.FunctionDef,
        ast.AsyncFunctionDef,
        ast.ClassDef,
        ast.Pass,
    )
    assign_types = (ast.Assign, ast.AnnAssign, ast.AugAssign)
    offenders: list[str] = []

    for node in tree.body:
        if isinstance(node, allowed_plain):
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            continue  # docstring / 裸字面量
        if _is_main_guard(node):
            continue

        # 顶层赋值:右侧(含嵌套)若有 Call,每个 Call 都必须在白名单,否则报问题行。
        if isinstance(node, assign_types):
            bad: list[int] = []
            for call in _walk_call_in_stmt(node):
                qn = _call_qualname(call)
                # 白名单匹配:module.func 全限定 或 单 func 名(如 getLogger)
                if qn and (
                    qn in _ASSIGN_SAFE_CALLS
                    or any(qn.split(".")[-1] == f[1] for f in _ASSIGN_SAFE_CALLS)
                ):
                    continue
                bad.append(getattr(call, "lineno", getattr(node, "lineno", -1)))
            if bad:
                offenders.append(
                    f"第{bad}行:顶层赋值含非白名单调用「{qn}」(import 时会执行)"
                )
                continue
            continue

        offenders.append(f"第{getattr(node, 'lineno', -1)}行:顶层 {type(node).__name__} 语句")

    if offenders:
        raise ValueError(
            "检测到模块顶层可执行副作用（安装 import 时会立即运行），已拒绝安装。问题：\n  "
            + "\n  ".join(offenders)
            + "\n请把逻辑放进 execute()，顶层只保留 import／常量／函数或类定义／"
            "getLogger/re.compile 这类无害初始化。确需顶层副作用，请在桌面端确认放行。"
        )


def compile_check(code: str, name: str, allow_side_effects: bool = False) -> None:
    """
    代码静态校验：体积上限 + compile() 语法检查 + 强制存在顶层 async def execute
    + 顶层副作用硬门(allow_side_effects=True 时跳过副作用检查,其余仍校验)。
    不执行代码。失败 raise ValueError。
    """
    if not isinstance(code, str) or not code.strip():
        raise ValueError("工具代码不能为空")
    if len(code.encode("utf-8")) > MAX_CODE_SIZE:
        raise ValueError(f"工具代码超过 {MAX_CODE_SIZE // 1024}KB 上限")
    try:
        tree = ast.parse(code, filename=f"{name}.py")
    except SyntaxError as exc:
        raise ValueError(f"代码语法错误：{exc}") from exc
    # 静态确认可被 compile（与 ast.parse 一致，双保险）
    compile(tree, f"{name}.py", "exec")
    has_execute = any(
        isinstance(node, ast.AsyncFunctionDef) and node.name == "execute"
        for node in tree.body
    )
    if not has_execute:
        raise ValueError("代码缺少顶层 `async def execute(params)` 函数，不符合工具契约。")
    if not allow_side_effects:
        check_top_level_side_effects(tree)


def _run_pip_install(pkgs: list[str]) -> None:
    """在当前解释器（即 venv python）里同步执行 pip install。失败 raise RuntimeError。"""
    proc = subprocess.run(
        [sys.executable, "-m", "pip", "install", *pkgs],
        capture_output=True,
        text=True,
        timeout=PIP_TIMEOUT,
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip()[-800:]
        raise RuntimeError(f"pip 安装依赖失败：{tail}")


def _load_execute_isolated(path: Path, module: str) -> Any:
    """在一次性隔离模块名下从 path 加载并取 execute。

    用 spec_from_file_location + exec_module 恰好执行顶层一次（不 import_module 再 reload，
    避免顶层副作用跑两遍）；隔离名不写进 sys.modules['tools.custom.*']，
    校验期间不污染生产模块，也不留半成品。失败 raise ValueError。
    """
    uniq = f"_toolcheck_{module}_{int(time.time() * 1000)}"
    spec = importlib.util.spec_from_file_location(uniq, path)
    if spec is None or spec.loader is None:
        raise ValueError("无法为工具模块创建导入 spec")
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)  # 顶层恰好执行一次
    except Exception as exc:  # noqa: BLE001 转成业务错误透传给调用方
        raise ValueError(f"工具模块导入失败：{exc}") from exc
    fn = getattr(mod, "execute", None)
    if fn is None or not callable(fn):
        raise ValueError("模块加载后未找到可调用的 execute")
    return fn


async def install_dependencies(dependencies: list[str]) -> list[str]:
    """逐个校验依赖后一次性 pip install（放线程池避免阻塞事件循环）。返回规范化后的包列表。"""
    if not dependencies:
        return []
    if len(dependencies) > MAX_DEPENDENCIES:
        raise ValueError(f"依赖数量超过 {MAX_DEPENDENCIES} 上限")
    validated = [validate_package(p) for p in dependencies]
    await asyncio.to_thread(_run_pip_install, validated)
    return validated


async def install_tool(payload: dict[str, Any], registry: dict[str, Any]) -> dict[str, Any]:
    """
    安装自定义工具：校验名/包/代码 → 装依赖 → 临时文件隔离导入取 execute → 原子提交模块文件 → 注册 → upsert registry.json。
    校验未通过前旧模块文件始终不被覆盖；任一步失败都不破坏已存在的同名工具，也不写 registry。返回元数据条目。
    """
    name = validate_tool_name(str(payload.get("name", "")))
    description = str(payload.get("description", "")).strip()
    # 自定义工具的可调用标签就是工具名本身；分类词只会让用户困惑。
    tags = [name]
    dependencies = [str(d) for d in (payload.get("dependencies") or [])]
    implementation = payload.get("implementation") if isinstance(payload.get("implementation"), dict) else {}
    capabilities = payload.get("capabilities") if isinstance(payload.get("capabilities"), list) else []
    code = str(payload.get("code", ""))
    source = str(payload.get("source", "generated"))
    # 顶层副作用放行位:默认 False(拒绝)。仅当调用方明确放行时才为 true。
    allow_side_effects = bool(payload.get("allow_top_level_side_effects", False))

    # 收紧:放行顶层副作用是绕过硬门的危险操作,必须留下审批记录(谁、为何批准)。
    # 缺 approved_by/reason 一律拒装——堵上「手搓 payload 静默绕过硬门却不留痕」的口子。
    approval = payload.get("approval") if isinstance(payload.get("approval"), dict) else {}
    approved_by = str(approval.get("approved_by", "")).strip()
    reason = str(approval.get("reason", "")).strip()
    if allow_side_effects and (not approved_by or not reason):
        raise ValueError(
            "放行顶层副作用(allow_top_level_side_effects=true)必须提供 approval.approved_by "
            "与 approval.reason,记录谁、为何批准该段代码。缺失已拒绝安装。"
        )

    compile_check(code, name, allow_side_effects=allow_side_effects)
    # 依赖预校验（真正安装前先拒绝非法包名，避免写文件后才失败）
    validated_deps = [validate_package(p) for p in dependencies]

    module = _module_name(name)
    module_path = dynamic.CUSTOM_DIR / f"{module}.py"
    dynamic.CUSTOM_DIR.mkdir(parents=True, exist_ok=True)

    # 依赖先装：失败则直接抛出，磁盘上的旧模块文件与 registry 均未被触碰。
    if validated_deps:
        await install_dependencies(validated_deps)

    # 新代码先写到同目录唯一临时文件，在隔离模块名下 import 校验（顶层只执行一次）；
    # 依赖装好、execute 校验通过后，再用 os.replace 原子提交。
    # 提交前旧模块文件始终不被覆盖——任何失败都不会破坏原本可用的工具。
    fd, tmp_name = tempfile.mkstemp(dir=dynamic.CUSTOM_DIR, suffix=".py")
    tmp_path: Path | None = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(code.encode("utf-8"))
        fn = _load_execute_isolated(tmp_path, module)
        os.replace(tmp_path, module_path)  # 校验通过后原子提交
        tmp_path = None  # 已提交，无需清理
        registry[name] = fn
    finally:
        if tmp_path is not None and tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass

    entry = {
        "name": name,
        "module": module,
        "description": description,
        "tags": tags,
        "dependencies": validated_deps,
        "implementation": {
            "language": str(implementation.get("language") or "Python 3.10+"),
            "libraries": [
                str(lib).strip()
                for lib in (implementation.get("libraries") or validated_deps or ["标准库"])
                if str(lib).strip()
            ],
            "note": str(implementation.get("note") or "").strip(),
        },
        "capabilities": [
            {
                "label": str(item.get("label") or "").strip(),
                "description": str(item.get("description") or "").strip(),
            }
            for item in capabilities[:MAX_CAPABILITIES]
            if isinstance(item, dict)
            and str(item.get("label") or "").strip()
            and str(item.get("description") or "").strip()
        ],
        "source": source,
        "createdAt": int(time.time() * 1000),
    }
    entries = [e for e in dynamic.read_registry() if e.get("name") != name]
    entries.append(entry)
    dynamic.write_registry(entries)

    # 审计:安装成功即记一条(尤其放行副作用时)。approved_by 未显式提供时按来源兜底,
    # 让报告中心能回答「谁、何时、批准了哪段代码」。写失败不影响已完成的安装。
    dynamic.append_audit_record({
        "ts": entry["createdAt"],
        "name": name,
        "approved_by": approved_by or ("jizi-auto" if source == "generated" else "unknown"),
        "reason": reason,
        "allow_side_effects": allow_side_effects,
        "code_sha256": hashlib.sha256(code.encode("utf-8")).hexdigest(),
        "code_excerpt": code[:256],
        "source": source,
    })
    return entry


def remove_tool(name: str, registry: dict[str, Any]) -> None:
    """删除自定义工具：拒删内置 → 删模块文件 + registry 条目 + 从 registry 反注册。"""
    if name in dynamic.BUILTIN_NAMES:
        raise ValueError(f"'{name}' 是内置工具，不允许删除。")
    entries = dynamic.read_registry()
    target = next((e for e in entries if e.get("name") == name), None)
    if target is None:
        raise ValueError(f"未找到自定义工具 '{name}'")

    module = target.get("module") or _module_name(name)
    module_path = dynamic.CUSTOM_DIR / f"{module}.py"
    if module_path.exists():
        try:
            module_path.unlink()
        except OSError as exc:
            raise RuntimeError(f"删除模块文件失败：{exc}") from exc

    dynamic.write_registry([e for e in entries if e.get("name") != name])
    registry.pop(name, None)
