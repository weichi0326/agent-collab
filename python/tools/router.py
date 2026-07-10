"""
工具路由：统一入口 POST /tools/{tool_name}/execute
每个工具接收 JSON params 并返回 { ok, result?, error? }。
"""
import logging
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any

from tools import file_tool
from tools import docx_tool
from tools.excel_tool import execute as excel_execute
from tools.pdf_read import execute as pdf_read_execute
from tools.llm_calling import execute as llm_execute
from tools import dynamic
from tools import installer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tools")

# 工具名 → 执行函数映射。
# file / docx 为合并后的多 action 工具（对齐 excel）；旧名 file-read/file-write/... 保留为
# 只读别名兜底，让未迁移的旧 Agent/画布标签仍能通过 listTools() 校验并正常执行。
_REGISTRY: dict[str, Any] = {
    "file": file_tool.execute,
    "docx": docx_tool.execute,
    "excel": excel_execute,
    "pdf-read": pdf_read_execute,
    "llm-calling": llm_execute,
    # ── 旧名别名（不在工具库/meta 露出，仅兜底） ──
    "file-read": file_tool.read_alias,
    "file-write": file_tool.write_alias,
    "file-delete": file_tool.delete_alias,
    "docx-read": docx_tool.read_alias,
    "docx-write": docx_tool.write_alias,
}

# 启动时扫描 custom/registry.json，把用户自定义 / 姬子生成的工具动态注册进来。
# 加载失败的条目会记日志并跳过（不阻断服务启动），并在 /tools/meta 中带 loadError。
dynamic.load_custom_tools(_REGISTRY)

# 对调用方可见的错误类型（ValueError/FileNotFoundError 等业务错误直接透传）
# RuntimeError/ImportError/OSError 等系统级错误只返回摘要，细节写日志
_SAFE_ERRORS = (ValueError, FileNotFoundError, PermissionError, RuntimeError)


class ExecuteRequest(BaseModel):
    params: dict[str, Any] = {}


class ExecuteResponse(BaseModel):
    ok: bool
    result: Any = None
    error: str | None = None


class InstallRequest(BaseModel):
    name: str
    description: str = ""
    tags: list[str] = []
    dependencies: list[str] = []
    implementation: dict[str, Any] | None = None
    capabilities: list[dict[str, Any]] = []
    code: str
    source: str = "generated"
    # 顶层副作用放行位:默认 False(硬拒绝)。必须在此声明,否则 body.model_dump() 会丢弃它,
    # installer 永远收不到、放行口失效(默认硬拒绝仍可用,人工放行不可用)。仅桌面 UI 勾选时前端传 true。
    allow_top_level_side_effects: bool = False
    # 审批元信息:{ approved_by, reason }。放行副作用时必填,否则 installer 拒装。同样须在此声明,
    # 否则 model_dump() 会丢弃,收紧校验永远拿不到审批人/原因。
    approval: dict[str, Any] | None = None


class InstallResponse(BaseModel):
    ok: bool
    error: str | None = None


@router.get("")
def list_tools() -> list[str]:
    """返回已注册的工具名称列表，供前端工具库状态查询。"""
    return list(_REGISTRY.keys())


@router.get("/meta")
def list_tools_meta() -> list[dict[str, Any]]:
    """
    返回内置 + 自定义工具的统一元数据（name/description/tags/source/builtin/loadError）。
    自定义部分每次从 registry.json 重读，loadError 反映当前进程是否已注册。
    """
    metas = dynamic.builtin_meta()
    for entry in dynamic.read_registry():
        name = entry.get("name")
        registered = name in _REGISTRY and name not in dynamic.BUILTIN_NAMES
        metas.append({
            "name": name,
            "module": entry.get("module"),
            "description": entry.get("description", ""),
            "tags": list(entry.get("tags") or []),
            "dependencies": list(entry.get("dependencies") or []),
            "implementation": entry.get("implementation"),
            "capabilities": list(entry.get("capabilities") or []),
            "source": entry.get("source", "manual"),
            "builtin": False,
            "internal": False,
            "createdAt": entry.get("createdAt"),
            "loadError": None if registered else "未加载（重启服务后生效，或查看服务日志排查）",
        })
    return metas


@router.get("/audit-log")
def tool_audit_log(limit: int = 200) -> dict[str, Any]:
    """返回工具安装审计日志(最近 limit 条,时间升序),供报告中心展示谁/何时/批准了哪段代码。"""
    capped = max(1, min(limit, dynamic.MAX_AUDIT_RECORDS))
    return {"records": dynamic.read_audit_log(limit=capped)}


@router.post("/{tool_name}/execute", response_model=ExecuteResponse)
async def execute_tool(tool_name: str, body: ExecuteRequest) -> ExecuteResponse:
    fn = _REGISTRY.get(tool_name)
    if fn is None:
        raise HTTPException(status_code=404, detail=f"未知工具: {tool_name}")
    started = time.monotonic()
    try:
        result = await fn(body.params)
        logger.info("[tool:%s] 成功，耗时 %dms", tool_name, int((time.monotonic() - started) * 1000))
        return ExecuteResponse(ok=True, result=result)
    except _SAFE_ERRORS as exc:
        # M9 修复：业务级异常（路径校验失败、文件不存在等）可以直接返回给调用方
        logger.info("[tool:%s] 业务失败，耗时 %dms：%s", tool_name, int((time.monotonic() - started) * 1000), exc)
        return ExecuteResponse(ok=False, error=str(exc))
    except Exception as exc:
        # M9 修复：系统级/未预期异常只返回通用摘要，详情写日志，防止敏感信息泄露
        logger.exception("[tool:%s] 执行失败，耗时 %dms", tool_name, int((time.monotonic() - started) * 1000))
        return ExecuteResponse(ok=False, error=f"工具 '{tool_name}' 执行失败，请查看服务日志获取详情")


@router.post("/install", response_model=InstallResponse)
async def install_tool(body: InstallRequest) -> InstallResponse:
    """
    安装自定义工具（落盘 + 装依赖 + 注册）。调用方须已完成「人工审阅完整代码」这一步。
    校验失败返回业务错误文案；系统级失败只返回摘要，详情写日志。
    """
    try:
        await installer.install_tool(body.model_dump(), _REGISTRY)
        return InstallResponse(ok=True)
    except _SAFE_ERRORS as exc:
        return InstallResponse(ok=False, error=str(exc))
    except Exception:
        logger.exception("[tool:install] 安装失败: %s", body.name)
        return InstallResponse(ok=False, error="工具安装失败，请查看服务日志获取详情")


@router.post("/{tool_name}/remove", response_model=InstallResponse)
def remove_tool(tool_name: str) -> InstallResponse:
    """删除自定义工具（仅自定义，拒删内置）。"""
    try:
        installer.remove_tool(tool_name, _REGISTRY)
        return InstallResponse(ok=True)
    except _SAFE_ERRORS as exc:
        return InstallResponse(ok=False, error=str(exc))
    except Exception:
        logger.exception("[tool:remove] 删除失败: %s", tool_name)
        return InstallResponse(ok=False, error="工具删除失败，请查看服务日志获取详情")
