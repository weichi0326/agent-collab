"""
docx 工具：对 Word .docx 文档进行读取与写入的统一入口。
参数 action 决定操作（对齐 excel 工具的多 action 风格）：

  read  (默认) 提取正文与表格文本
  write 根据结构化内容生成 .docx 文档
  meta  读取文档元信息

各 action 的具体参数见对应实现模块（docx_read / docx_write）。
"""
from typing import Any

from tools.docx_read import execute as _read_execute
from tools.docx_write import execute as _write_execute


async def execute(params: dict[str, Any]) -> Any:
    action: str = str(params.get("action") or "read")

    if action == "read":
        return await _read_execute({**params, "action": "text"})

    if action == "meta":
        return await _read_execute({**params, "action": "meta"})

    if action == "write":
        write_params = dict(params)
        write_params.pop("action", None)
        return await _write_execute(write_params)

    raise ValueError(f"未知 action: {action}（支持 read/write/meta）")


# 旧工具名别名：注入固定 action，保证未迁移的旧数据 / 旧调用仍可用。
async def read_alias(params: dict[str, Any]) -> Any:
    return await execute({**params, "action": "read"})


async def write_alias(params: dict[str, Any]) -> Any:
    return await execute({**params, "action": "write"})
