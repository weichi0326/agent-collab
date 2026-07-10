"""原子写入辅助: tempfile.mkstemp → os.fdopen → os.replace, 失败清理 tmp。

供 file_write 等工具复用, 消除 mkstemp + replace + cleanup 样板重复。
调用方负责父目录已存在 (mkdir)。
"""
import os
import tempfile
from pathlib import Path


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """以原子方式向 path 写入 bytes: 先在同级目录建临时文件, 写完 os.replace 替换。

    临时文件与目标文件同目录, 保证 os.replace 是原子操作。任何异常都会清理临时文件并重新抛出。
    """
    dir_ = path.parent
    tmp_path: str | None = None
    fd = None
    try:
        fd, tmp_path = tempfile.mkstemp(dir=dir_, suffix=".tmp")
        with os.fdopen(fd, "wb") as f:
            fd = None  # fdopen 接管 fd, 避免重复关闭
            f.write(data)
        os.replace(tmp_path, path)
        tmp_path = None  # replace 成功, 不需要清理
    except Exception:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
        if tmp_path is not None:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        raise
