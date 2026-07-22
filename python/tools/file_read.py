"""
file-read 工具：读取本地文件内容。
params:
  path    (str, 必填) 文件绝对路径（须在允许根目录内）
  mode    (str, 可选) "text"（默认）| "lines" | "binary_b64" | "meta"
  encoding (str, 可选) 文本编码，默认 auto（chardet 自动检测）
  limit_lines (int, 可选) mode=lines 时最多返回行数，最大 10000
"""
import base64
from typing import Any

from tools.sandbox import resolve_safe_path

try:
    import chardet
    _HAS_CHARDET = True
except ImportError:
    _HAS_CHARDET = False

# H6：文件大小上限 50 MB，防止整文件读入耗尽内存
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_LIMIT_LINES = 10_000


def _detect_encoding(raw: bytes) -> str:
    if _HAS_CHARDET:
        result = chardet.detect(raw[:65536])
        return result.get("encoding") or "utf-8"
    return "utf-8"


async def execute(params: dict[str, Any]) -> Any:
    path_str: str = params.get("path", "")
    if not path_str:
        raise ValueError("缺少必填参数 path")

    # H1：路径沙箱校验（防路径穿越）
    path = resolve_safe_path(path_str)

    if not path.exists():
        raise FileNotFoundError(f"文件不存在: {path}")
    if not path.is_file():
        raise ValueError(f"路径不是文件: {path}")

    mode: str = params.get("mode", "text")

    if mode == "meta":
        stat = path.stat()
        return {
            "name": path.name,
            "size": stat.st_size,
            "modified": stat.st_mtime,
            "created": stat.st_ctime,
            "suffix": path.suffix,
        }

    # H6：读取前检查大小，超限拒绝
    file_size = path.stat().st_size
    if file_size > MAX_FILE_SIZE:
        raise ValueError(
            f"文件过大（{file_size // 1024 // 1024} MB），超过 {MAX_FILE_SIZE // 1024 // 1024} MB 上限"
        )

    raw = path.read_bytes()

    if mode == "binary_b64":
        return {"data": base64.b64encode(raw).decode("ascii"), "size": len(raw)}

    encoding = params.get("encoding", "auto")
    if encoding == "auto":
        encoding = _detect_encoding(raw)

    text = raw.decode(encoding, errors="replace")

    if mode == "lines":
        raw_limit = params.get("limit_lines")
        limit = min(int(raw_limit), MAX_LIMIT_LINES) if raw_limit is not None else MAX_LIMIT_LINES
        lines = text.splitlines()
        total = len(lines)
        lines = lines[:limit]
        return {"lines": lines, "total_lines": total, "encoding": encoding}

    # mode == "text"（默认）
    return {"content": text, "encoding": encoding, "size": len(raw)}
