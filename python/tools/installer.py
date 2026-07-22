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
import inspect
import os
import re
import subprocess
import sys
import tempfile
import threading
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
_REGISTRY_COMMIT_LOCK = threading.Lock()


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
    if (
        not isinstance(test, ast.Compare)
        or len(test.ops) != 1
        or not isinstance(test.ops[0], ast.Eq)
        or len(test.comparators) != 1
        or node.orelse
    ):
        return False
    right = test.comparators[0]
    return (
        isinstance(test.left, ast.Name)
        and test.left.id == "__name__"
        and isinstance(right, ast.Constant)
        and right.value == "__main__"
    ) or (
        isinstance(test.left, ast.Constant)
        and test.left.value == "__main__"
        and isinstance(right, ast.Name)
        and right.id == "__name__"
    )


# 赋值右侧允许调用的白名单:典型「import 期的无害基础设施初始化」。
# 形如 (<module>, <func>) 完全限定名;匹配走 _allowed_call_name。
_SAFE_IMPORT_TIME_CALLS = frozenset(
    {
        "logging.getLogger",
        "re.compile",
        "collections.namedtuple",
        "dataclasses.dataclass",
        "enum.Enum",
        "pathlib.Path",
        "decimal.Decimal",
        "datetime.datetime",
        "datetime.date",
        "datetime.time",
        "datetime.timedelta",
        "typing.TypeVar",
        "typing.NewType",
    }
)

_SAFE_DECORATORS = frozenset(
    {
        "builtins.classmethod",
        "builtins.property",
        "builtins.staticmethod",
        "dataclasses.dataclass",
        "functools.cache",
        "functools.lru_cache",
    }
)

_SAFE_CLASS_BASES = frozenset(
    {
        "builtins.object",
        "builtins.Exception",
        "builtins.ValueError",
        "builtins.RuntimeError",
        "builtins.TypeError",
        "builtins.LookupError",
        "builtins.KeyError",
        "enum.Enum",
    }
)


def _import_bindings(tree: ast.Module) -> dict[str, str]:
    """建立本地导入名到真实限定名的映射，防止 `evil.getLogger()` 伪装白名单。"""
    bindings: dict[str, str] = {
        "classmethod": "builtins.classmethod",
        "Exception": "builtins.Exception",
        "KeyError": "builtins.KeyError",
        "LookupError": "builtins.LookupError",
        "object": "builtins.object",
        "property": "builtins.property",
        "RuntimeError": "builtins.RuntimeError",
        "staticmethod": "builtins.staticmethod",
        "TypeError": "builtins.TypeError",
        "ValueError": "builtins.ValueError",
    }
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                local = alias.asname or alias.name.split(".", 1)[0]
                target = alias.name if alias.asname else alias.name.split(".", 1)[0]
                bindings[local] = target
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            for alias in node.names:
                if alias.name == "*":
                    continue
                bindings[alias.asname or alias.name] = f"{node.module}.{alias.name}"
    return bindings


def _qualified_name(node: ast.AST, bindings: dict[str, str]) -> str | None:
    if isinstance(node, ast.Name):
        return bindings.get(node.id)
    if isinstance(node, ast.Attribute):
        parent = _qualified_name(node.value, bindings)
        return f"{parent}.{node.attr}" if parent else None
    return None


def _call_qualname(node: ast.Call, bindings: dict[str, str]) -> str | None:
    return _qualified_name(node.func, bindings)


def _walk_calls(node: ast.AST):
    """对顶层语句递归找所有 Call——但只遍历「会执行的副作用位」,避开 def/class 内部体。"""
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            yield child


def _unsafe_call_lines(nodes: list[ast.AST], bindings: dict[str, str]) -> list[str]:
    unsafe: list[str] = []
    for node in nodes:
        for call in _walk_calls(node):
            qualname = _call_qualname(call, bindings)
            if qualname not in _SAFE_IMPORT_TIME_CALLS:
                unsafe.append(f"第{getattr(call, 'lineno', -1)}行:{qualname or '<动态调用>'}")
    return unsafe


def _definition_time_expressions(
    node: ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef,
) -> list[ast.AST]:
    expressions: list[ast.AST] = list(node.decorator_list)
    if isinstance(node, ast.ClassDef):
        expressions.extend(node.bases)
        expressions.extend(keyword.value for keyword in node.keywords)
        return expressions

    args = node.args
    expressions.extend(args.defaults)
    expressions.extend(default for default in args.kw_defaults if default is not None)
    annotations = [arg.annotation for arg in (*args.posonlyargs, *args.args, *args.kwonlyargs)]
    if args.vararg:
        annotations.append(args.vararg.annotation)
    if args.kwarg:
        annotations.append(args.kwarg.annotation)
    expressions.extend(annotation for annotation in annotations if annotation is not None)
    if node.returns is not None:
        expressions.append(node.returns)
    return expressions


def _unsafe_decorators(
    node: ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef,
    bindings: dict[str, str],
) -> list[str]:
    unsafe: list[str] = []
    for decorator in node.decorator_list:
        target = decorator.func if isinstance(decorator, ast.Call) else decorator
        qualname = _qualified_name(target, bindings)
        if qualname not in _SAFE_DECORATORS:
            unsafe.append(
                f"第{getattr(decorator, 'lineno', -1)}行:{qualname or '<动态装饰器>'}"
            )
    return unsafe


def _plain_assignment_names(target: ast.AST) -> set[str] | None:
    if isinstance(target, ast.Name):
        return {target.id}
    if isinstance(target, (ast.Tuple, ast.List)):
        names: set[str] = set()
        for element in target.elts:
            child_names = _plain_assignment_names(element)
            if child_names is None:
                return None
            names.update(child_names)
        return names
    return None


def _assignment_names(node: ast.Assign | ast.AnnAssign | ast.AugAssign) -> set[str] | None:
    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
    names: set[str] = set()
    for target in targets:
        target_names = _plain_assignment_names(target)
        if target_names is None:
            return None
        names.update(target_names)
    return names


def _unsafe_class_structure(node: ast.ClassDef, bindings: dict[str, str]) -> list[str]:
    unsafe: list[str] = []
    for base in node.bases:
        qualname = _qualified_name(base, bindings)
        if qualname not in _SAFE_CLASS_BASES:
            unsafe.append(
                f"第{getattr(base, 'lineno', -1)}行:{qualname or '<动态基类>'}"
            )
    for keyword in node.keywords:
        unsafe.append(
            f"第{getattr(keyword.value, 'lineno', -1)}行:类关键字 {keyword.arg or '<展开参数>'}"
        )
    return unsafe


def check_top_level_side_effects(tree: ast.Module) -> None:
    """扫描模块顶层,拒绝「import 时会执行工作」的副作用。硬门(installer 端,非前端)。

    允许:import / 函数或类定义 / docstring / pass / __main__ 守卫 /
    顶层赋值(但赋值右侧若含 Call 则走白名单,只放 logger=getLogger/re.compile 这类无害初始化)。
    拒绝:裸调用表达式(结果丢弃=纯副作用,如 os.system(...)) /
    顶层赋值含非白名单调用(如 _ = os.system('rm -rf /')) /
    顶层循环 / with / try / 非守卫 if(import 时会真跑)。
    """
    assign_types = (ast.Assign, ast.AnnAssign, ast.AugAssign)
    offenders: list[str] = []
    bindings = _import_bindings(tree)

    def check_statements(statements: list[ast.stmt], scope: str) -> None:
        for node in statements:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                if scope != "模块":
                    offenders.append(
                        f"第{getattr(node, 'lineno', -1)}行:{scope} 中的 import 会在类创建时执行"
                    )
                continue
            if isinstance(node, ast.Pass):
                continue
            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
                continue  # docstring / 裸字面量
            if scope == "模块" and _is_main_guard(node):
                continue

            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                unsafe = _unsafe_call_lines(_definition_time_expressions(node), bindings)
                unsafe.extend(_unsafe_decorators(node, bindings))
                if node.name in bindings:
                    unsafe.append(f"第{node.lineno}行:覆盖受保护名称 {node.name}")
                if isinstance(node, ast.ClassDef):
                    unsafe.extend(_unsafe_class_structure(node, bindings))
                if unsafe:
                    offenders.append(
                        f"{scope}定义「{node.name}」含 import 时调用: {', '.join(unsafe)}"
                    )
                if isinstance(node, ast.ClassDef):
                    check_statements(node.body, f"类 {node.name}")
                continue

            if isinstance(node, assign_types):
                names = _assignment_names(node)
                if names is None:
                    offenders.append(
                        f"第{getattr(node, 'lineno', -1)}行:{scope} 赋值会修改属性或下标"
                    )
                    continue
                shadowed = sorted(names.intersection(bindings))
                if shadowed:
                    offenders.append(
                        f"第{getattr(node, 'lineno', -1)}行:{scope} 赋值覆盖受保护名称: {', '.join(shadowed)}"
                    )
                    continue
                if any(isinstance(child, ast.NamedExpr) for child in ast.walk(node)):
                    offenders.append(
                        f"第{getattr(node, 'lineno', -1)}行:{scope} 赋值包含命名表达式"
                    )
                    continue
                unsafe = _unsafe_call_lines([node], bindings)
                if unsafe:
                    offenders.append(
                        f"{scope}赋值含非白名单调用: {', '.join(unsafe)}"
                    )
                continue

            offenders.append(
                f"第{getattr(node, 'lineno', -1)}行:{scope} {type(node).__name__} 语句"
            )

    check_statements(tree.body, "模块")

    if offenders:
        raise ValueError(
            "检测到模块顶层可执行副作用（安装 import 时会立即运行），已拒绝安装。问题：\n  "
            + "\n  ".join(offenders)
            + "\n请把逻辑放进 execute()，顶层只保留 import／常量／函数或类定义／"
            "getLogger/re.compile 这类无害初始化。确需顶层副作用，请在桌面端确认放行。"
        )


def _validate_execute_contract(tree: ast.Module) -> None:
    named = [
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == "execute"
    ]
    if len(named) != 1 or not isinstance(named[0], ast.AsyncFunctionDef):
        raise ValueError("代码必须且只能包含一个顶层 `async def execute(params)` 函数。")

    execute = named[0]
    args = execute.args
    positional = [*args.posonlyargs, *args.args]
    valid = (
        len(positional) == 1
        and positional[0].arg == "params"
        and not args.defaults
        and not args.kwonlyargs
        and args.vararg is None
        and args.kwarg is None
        and not execute.decorator_list
    )
    if not valid:
        raise ValueError(
            "execute 契约不正确：必须使用未装饰的 `async def execute(params)`，"
            "且不能包含额外参数、默认值、*args 或 **kwargs。"
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
    _validate_execute_contract(tree)
    if not allow_side_effects:
        check_top_level_side_effects(tree)


def _run_pip_install(pkgs: list[str]) -> None:
    """把自定义依赖装到用户数据目录，应用升级时不会被新运行时覆盖。"""
    target = dynamic.user_packages_dir()
    target.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--upgrade",
            "--target",
            str(target),
            *pkgs,
        ],
        capture_output=True,
        text=True,
        timeout=PIP_TIMEOUT,
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip()[-800:]
        raise RuntimeError(f"pip 安装依赖失败：{tail}")
    dynamic.ensure_custom_runtime_paths()


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
    if fn is None or not callable(fn) or not inspect.iscoroutinefunction(fn):
        raise ValueError("模块加载后的 execute 不是可调用的协程函数")
    signature = inspect.signature(fn)
    parameters = list(signature.parameters.values())
    if (
        len(parameters) != 1
        or parameters[0].name != "params"
        or parameters[0].default is not inspect.Parameter.empty
        or parameters[0].kind
        not in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    ):
        raise ValueError("模块加载后的 execute 必须严格符合 `async execute(params)` 契约")
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

    # 新代码先写到同目录唯一临时文件，在隔离模块名下 import 校验（顶层只执行一次）；
    # 模块文件与 registry 作为一个提交单元，registry 写入失败会恢复旧模块。
    fd, tmp_name = tempfile.mkstemp(dir=dynamic.CUSTOM_DIR, suffix=".py")
    tmp_path: Path | None = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(code.encode("utf-8"))
        fn = _load_execute_isolated(tmp_path, module)
        with _REGISTRY_COMMIT_LOCK:
            old_module = module_path.read_bytes() if module_path.exists() else None
            entries = [e for e in dynamic.read_registry() if e.get("name") != name]
            entries.append(entry)
            os.replace(tmp_path, module_path)
            tmp_path = None
            try:
                dynamic.write_registry(entries)
            except Exception:
                if old_module is None:
                    module_path.unlink(missing_ok=True)
                else:
                    dynamic.atomic_write_bytes(module_path, old_module)
                raise
            registry[name] = fn
    finally:
        if tmp_path is not None and tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass

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
    with _REGISTRY_COMMIT_LOCK:
        entries = dynamic.read_registry()
        target = next((e for e in entries if e.get("name") == name), None)
        if target is None:
            raise ValueError(f"未找到自定义工具 '{name}'")

        module = target.get("module") or _module_name(name)
        module_path = dynamic.CUSTOM_DIR / f"{module}.py"
        old_module = module_path.read_bytes() if module_path.exists() else None
        if old_module is not None:
            try:
                module_path.unlink()
            except OSError as exc:
                raise RuntimeError(f"删除模块文件失败：{exc}") from exc

        try:
            dynamic.write_registry([e for e in entries if e.get("name") != name])
        except Exception:
            if old_module is not None:
                dynamic.atomic_write_bytes(module_path, old_module)
            raise
        registry.pop(name, None)
