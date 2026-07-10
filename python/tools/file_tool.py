"""
file 工具：对本地文件进行读取、写入与删除的统一入口。
参数 action 决定操作（对齐 excel 工具的多 action 风格）：

  read   (默认) 读取文件内容
  write  写入 / 追加内容（支持文本与二进制）
  delete 删除已知产物文件
  meta   读取文件元信息

各 action 的具体参数见对应实现模块（file_read / file_write / file_delete）。
"""
from typing import Any

from tools.file_read import execute as _read_execute
from tools.file_write import execute as _write_execute
from tools.file_delete import execute as _delete_execute


async def execute(params: dict[str, Any]) -> Any:
    action: str = str(params.get("action") or "read")

    if action == "read":
        # read 下沿用 file_read 的 mode（text/lines/binary_b64），默认 text
        read_params = dict(params)
        read_params.pop("action", None)
        read_params.setdefault("mode", "text")
        return await _read_execute(read_params)

    if action == "meta":
        return await _read_execute({**params, "mode": "meta"})

    if action == "write":
        # write 下 mode 表示 overwrite/append；binary_b64=true 时写二进制
        write_params = dict(params)
        write_params.pop("action", None)
        if write_params.get("mode") not in ("overwrite", "append"):
            write_params["mode"] = "overwrite"
        return await _write_execute(write_params)

    if action == "delete":
        delete_params = dict(params)
        delete_params.pop("action", None)
        return await _delete_execute(delete_params)

    raise ValueError(f"未知 action: {action}（支持 read/write/delete/meta）")


# 旧工具名别名：注入固定 action，保证未迁移的旧数据 / 旧调用仍可用。
async def read_alias(params: dict[str, Any]) -> Any:
    return await execute({**params, "action": "read"})


async def write_alias(params: dict[str, Any]) -> Any:
    return await execute({**params, "action": "write"})


async def delete_alias(params: dict[str, Any]) -> Any:
    return await execute({**params, "action": "delete"})
