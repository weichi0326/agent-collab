"""
file-delete 工具：删除已知产物文件，并可清理空父目录。
params:
  path                 (str, 可选) 单个目标文件路径
  paths                (list[str], 可选) 多个目标文件路径
  remove_empty_parents (bool, 可选) 删除文件后尝试移除空父目录，默认 true
  allow_outside_roots  (bool, 可选) 是否允许删除用户明确选择的外部绝对路径产物，默认 false

仅删除文件，不递归删除目录；所有路径必须先通过沙箱校验。
"""
from pathlib import Path
from typing import Any

from tools.sandbox import get_allowed_roots, resolve_safe_path

MAX_BATCH_SIZE = 100


def _is_allowed_root(path: Path) -> bool:
    resolved = path.resolve()
    for root in get_allowed_roots():
        try:
            if resolved == root.resolve():
                return True
        except OSError:
            continue
    return False


def _remove_empty_parents(path: Path, stop_at: Path | None = None) -> list[str]:
    removed: list[str] = []
    current = path.parent
    stop_resolved = stop_at.resolve() if stop_at else None
    while not _is_allowed_root(current):
        try:
            if stop_resolved is not None and current.resolve() == stop_resolved:
                break
        except OSError:
            break
        if current == current.parent:
            break
        try:
            current.rmdir()
        except OSError:
            break
        removed.append(str(current))
        current = current.parent
    return removed


async def execute(params: dict[str, Any]) -> Any:
    raw_paths: list[str] = []
    if isinstance(params.get("path"), str) and params["path"]:
        raw_paths.append(params["path"])
    if isinstance(params.get("paths"), list):
        raw_paths.extend(str(p) for p in params["paths"] if str(p).strip())

    if not raw_paths:
        raise ValueError("缺少必填参数 path 或 paths")

    if len(raw_paths) > MAX_BATCH_SIZE:
        raise ValueError(f"paths batch size must be <= {MAX_BATCH_SIZE}")

    remove_empty_parents: bool = params.get("remove_empty_parents", True)
    allow_outside_roots: bool = params.get("allow_outside_roots", False)
    deleted: list[str] = []
    missing: list[str] = []
    empty_dirs: list[str] = []

    for raw in raw_paths:
        path = resolve_safe_path(raw, allow_outside_roots=allow_outside_roots)
        if not path.exists():
            missing.append(str(path))
            continue
        if not path.is_file():
            raise ValueError(f"仅允许删除文件，拒绝删除目录: {path}")
        path.unlink()
        deleted.append(str(path))
        if remove_empty_parents:
            stop_at = path.parent.parent if allow_outside_roots else None
            empty_dirs.extend(_remove_empty_parents(path, stop_at=stop_at))

    return {
        "deleted": deleted,
        "missing": missing,
        "removed_empty_dirs": empty_dirs,
    }
