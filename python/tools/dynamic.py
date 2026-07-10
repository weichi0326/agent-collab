"""
动态工具注册：从 tools/custom/registry.json 读取用户自定义 / 姬子生成的工具，
importlib 加载各模块的 execute 并注册进传入的 _REGISTRY；同时提供内置工具的统一元数据。

安全说明：仅在服务进程内导入 custom/ 下的模块。这些模块由「工具库安装」或「姬子生成→人工确认」
写入，未经确认的代码不会落盘到此目录。启动扫描保证服务重启后自定义工具仍然可用。
"""
import importlib
import json
import logging
import sys
from pathlib import Path
from typing import Any

from tools.atomic_io import atomic_write_bytes

logger = logging.getLogger(__name__)

CUSTOM_DIR = Path(__file__).parent / "custom"
REGISTRY_PATH = CUSTOM_DIR / "registry.json"
# 工具安装审计日志(append-only JSONL,每行一条)。与 registry.json 同域,属运行时用户数据,
# 不随 build-dist 打包(custom/ 下仅 __init__.py 入包)。报告中心据此展示「谁、何时、批准了哪段代码」。
AUDIT_PATH = CUSTOM_DIR / "tool-audit.jsonl"
MAX_AUDIT_RECORDS = 500

# 内置工具统一元数据（name 与前端 toolRegistry.ts 的 value 保持一致）。
# internal=True 的工具供系统内部使用（删除文件 / LLM 代理），仍返回以保证完整性。
BUILTIN_META: list[dict[str, Any]] = [
    {"name": "file", "description": "读取 / 写入 / 删除本地文件（文本与二进制）", "tags": ["file"], "internal": False},
    {"name": "docx", "description": "读取与生成 Word .docx 文档", "tags": ["docx"], "internal": False},
    {"name": "excel", "description": "读写与格式化 Excel 工作簿", "tags": ["excel"], "internal": False},
    {"name": "pdf-read", "description": "从 PDF 提取文本、表格与元信息", "tags": ["pdf-read", "pdf"], "internal": False},
    {"name": "llm-calling", "description": "在服务端代理调用 LLM API", "tags": ["llm-calling", "llm"], "internal": True},
]

# 旧工具名别名：不在工具库 / meta 露出，但仍受删除保护、禁止被同名自定义工具覆盖。
ALIAS_NAMES = frozenset({"file-read", "file-write", "file-delete", "docx-read", "docx-write"})

BUILTIN_NAMES = frozenset(m["name"] for m in BUILTIN_META) | ALIAS_NAMES


def builtin_meta() -> list[dict[str, Any]]:
    """返回内置工具的统一元数据（带 source/builtin 标记）。"""
    return [
        {
            "name": m["name"],
            "module": None,
            "description": m["description"],
            "tags": list(m["tags"]),
            "dependencies": [],
            "source": "builtin",
            "builtin": True,
            "internal": m.get("internal", False),
            "createdAt": None,
            "loadError": None,
        }
        for m in BUILTIN_META
    ]


def read_registry() -> list[dict[str, Any]]:
    """读取 registry.json；缺失或损坏时返回 []。只保留含 name+module 的合法条目。"""
    if not REGISTRY_PATH.exists():
        return []
    try:
        data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        logger.exception("[dynamic] registry.json 解析失败，视为空")
        return []
    if not isinstance(data, list):
        return []
    return [
        e for e in data
        if isinstance(e, dict) and e.get("name") and e.get("module")
    ]


def write_registry(entries: list[dict[str, Any]]) -> None:
    """写回 registry.json（保证目录存在）。"""
    CUSTOM_DIR.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(entries, ensure_ascii=False, indent=2).encode("utf-8")
    atomic_write_bytes(REGISTRY_PATH, payload)

def read_audit_log(limit: int = 200) -> list[dict[str, Any]]:
    """读取工具安装审计日志(最近 limit 条,按时间升序)。缺失/损坏行跳过。"""
    if not AUDIT_PATH.exists():
        return []
    try:
        lines = AUDIT_PATH.read_text(encoding="utf-8").splitlines()
    except OSError:
        logger.exception("[dynamic] 审计日志读取失败")
        return []
    records: list[dict[str, Any]] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict):
            records.append(obj)
    return records[-limit:] if limit > 0 else records


def append_audit_record(record: dict[str, Any]) -> None:
    """追加一条审计记录并原子重写(封顶 MAX_AUDIT_RECORDS，超出丢最旧)。写失败只记日志、不抛。"""
    try:
        AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
        kept = read_audit_log(limit=MAX_AUDIT_RECORDS - 1)
        kept.append(record)
        payload = (
            "\n".join(json.dumps(r, ensure_ascii=False) for r in kept) + "\n"
        ).encode("utf-8")
        atomic_write_bytes(AUDIT_PATH, payload)
    except Exception:  # noqa: BLE001 审计写失败不应影响已完成的安装
        logger.exception("[dynamic] 审计日志写入失败")


def load_custom_tools(registry: dict[str, Any]) -> None:
    """
    读 registry.json，对每条导入模块取 execute 注册进 registry（原地修改）。
    加载失败的条目记日志并跳过（不阻断服务启动，/tools/meta 据 registry 反映 loadError）。

    只对「已在 sys.modules 中」的模块 reload，否则首次 import_module——
    保证新进程启动时每个模块顶层恰好执行一次（不再 import 后立刻无条件 reload）。
    """
    for entry in read_registry():
        name = entry["name"]
        module = entry["module"]
        if name in BUILTIN_NAMES:
            continue
        module_key = f"tools.custom.{module}"
        try:
            if module_key in sys.modules:
                # 仅当已加载才 reload（覆盖安装/热更新场景），拿到最新代码。
                mod = importlib.reload(sys.modules[module_key])
            else:
                mod = importlib.import_module(module_key)
            fn = getattr(mod, "execute", None)
            if fn is not None and callable(fn):
                registry[name] = fn
            else:
                logger.warning("[dynamic] 自定义工具 %s 缺少可调用的 execute，已跳过", name)
        except Exception:  # noqa: BLE001 导入失败不应阻断服务启动
            logger.exception("[dynamic] 加载自定义工具失败: %s", name)
