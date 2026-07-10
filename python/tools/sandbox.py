"""
路径沙箱：将用户传入的原始路径解析为绝对路径，并验证它位于允许的根目录之内。
所有文件 I/O 工具（file_read、file_write、excel_tool、pdf_read）
在使用任何 path 参数前必须通过此模块校验。

安全目标：防止路径穿越攻击（如 ../../etc/passwd 或 C:\\Windows\\System32\\...）
"""
from pathlib import Path
from typing import Union
import os

# 默认允许的根目录列表：用户主目录 + 桌面
# Python 服务运行时可通过 AGENT_ALLOWED_ROOTS 环境变量覆盖（分号分隔的多个路径）
def _default_allowed_roots() -> list[Path]:
    roots = []
    home = Path.home()
    roots.append(home)
    # Windows 桌面
    desktop = home / "Desktop"
    if desktop.exists():
        roots.append(desktop)
    # 可通过环境变量追加额外允许目录
    env_extra = os.environ.get("AGENT_ALLOWED_ROOTS", "")
    for p in env_extra.split(";"):
        p = p.strip()
        if p:
            roots.append(Path(p))
    return roots


_ALLOWED_ROOTS: list[Path] | None = None


def get_allowed_roots() -> list[Path]:
    global _ALLOWED_ROOTS
    if _ALLOWED_ROOTS is None:
        _ALLOWED_ROOTS = _default_allowed_roots()
    return _ALLOWED_ROOTS


def resolve_safe_path(
    raw: Union[str, Path],
    extra_roots: list[Path] | None = None,
    allow_outside_roots: bool = False,
) -> Path:
    """
    将 raw 解析为真实绝对路径，检验其位于允许根目录之内。

    Args:
        raw: 来自用户输入的原始路径字符串或 Path 对象。
        extra_roots: 可选的额外允许根目录（用于 out_path 等次级路径参数）。

    Returns:
        经过解析和验证的绝对路径。

    Raises:
        ValueError: 路径为空、无法解析为绝对路径、或不在任何允许根目录之内。
    """
    if not raw:
        raise ValueError("路径参数不能为空")

    raw_path = Path(str(raw)).expanduser()
    if allow_outside_roots and not raw_path.is_absolute():
        raise ValueError("允许外部目录时路径必须是绝对路径")

    try:
        # resolve() 展开符号链接并消除 .. 等相对段
        resolved = raw_path.resolve()
    except (OSError, RuntimeError) as e:
        raise ValueError(f"路径解析失败: {e}") from e

    if allow_outside_roots:
        return resolved

    allowed = get_allowed_roots() + (extra_roots or [])

    for root in allowed:
        try:
            root_resolved = root.resolve()
            # 检查 resolved 是否在 root_resolved 之内（含 root 本身）
            resolved.relative_to(root_resolved)
            return resolved
        except ValueError:
            continue

    allowed_str = ", ".join(str(r) for r in allowed)
    raise ValueError(
        f"拒绝访问：路径 '{resolved}' 超出允许范围。\n"
        f"允许的根目录：{allowed_str}\n"
        f"如需访问其他目录，请设置环境变量 AGENT_ALLOWED_ROOTS（分号分隔）。"
    )
