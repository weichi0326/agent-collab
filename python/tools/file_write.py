"""
file-write 工具：向本地文件写入内容（支持原子写入）。
params:
  path     (str, 必填) 目标文件绝对路径（须在允许根目录内）
  content  (str, 必填) 要写入的内容；binary_b64=true 时为 base64 字符串（最大 50 MB）
  mode     (str, 可选) "overwrite"（默认）| "append"
  encoding (str, 可选) 写入编码，默认 utf-8（binary_b64=true 时忽略）
  binary_b64 (bool, 可选) content 是否为 base64 编码的二进制内容，默认 false（写入图片/压缩包等）
  mkdir    (bool, 可选) 是否自动创建父目录，默认 true
  atomic   (bool, 可选) 是否原子写入（先写临时文件再替换），默认 true
  allow_outside_roots (bool, 可选) 是否允许写入用户明确选择的外部绝对路径，默认 false
  output_root (str, 可选) 用户在节点中选择的输出目录；外部路径写入失败时仅允许修复该目录权限
  allow_elevated_permission_repair (bool, 可选) 兼容旧参数，当前已禁用 UAC 提权修复
"""
import base64
import binascii
import os
import subprocess
from pathlib import Path
from typing import Any

from tools.sandbox import resolve_safe_path
from tools.atomic_io import atomic_write_bytes

MAX_CONTENT_SIZE = 50 * 1024 * 1024  # 50 MB 字符上限


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _is_dangerous_repair_root(path: Path) -> bool:
    resolved = path.resolve()
    if resolved == Path(resolved.anchor):
        return True

    windir = os.environ.get("WINDIR")
    critical_roots = [
        Path(p)
        for p in [
            windir,
            os.environ.get("ProgramFiles"),
            os.environ.get("ProgramFiles(x86)"),
        ]
        if p
    ]
    for root in critical_roots:
        try:
            root_resolved = root.resolve()
        except OSError:
            continue
        if resolved == root_resolved or _is_relative_to(resolved, root_resolved):
            return True
    return False


def _current_windows_identity() -> str:
    try:
        sid_proc = subprocess.run(
            ["whoami", "/user", "/fo", "csv", "/nh"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if sid_proc.returncode == 0:
            parts = [p.strip().strip('"') for p in sid_proc.stdout.strip().split(",")]
            if len(parts) >= 2 and parts[1]:
                return f"*{parts[1]}"
    except (OSError, subprocess.SubprocessError):
        pass

    try:
        whoami_proc = subprocess.run(
            ["whoami"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if whoami_proc.returncode == 0 and whoami_proc.stdout.strip():
            return whoami_proc.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass

    username = os.environ.get("USERNAME")
    if username:
        return username
    raise RuntimeError("无法识别当前 Windows 用户，不能自动修复输出目录权限")


def _run_repair_command(args: list[str], timeout: int = 60) -> tuple[bool, str]:
    try:
        proc = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"命令超时（{timeout} 秒）"
    output = "\n".join(part.strip() for part in [proc.stdout, proc.stderr] if part.strip())
    return proc.returncode == 0, output


def _repair_windows_output_permissions(
    path: Path,
    output_root_raw: str | None,
) -> list[str]:
    if os.name != "nt":
        return ["当前系统不是 Windows，跳过 ACL 自动修复"]
    if not output_root_raw or not output_root_raw.strip():
        return ["缺少 output_root，无法确认用户选择的输出目录，跳过 ACL 自动修复"]

    output_root = resolve_safe_path(output_root_raw, allow_outside_roots=True)
    if not _is_relative_to(path, output_root):
        return [f"目标文件不在输出目录内，跳过 ACL 自动修复: {output_root}"]
    if _is_dangerous_repair_root(output_root):
        return [f"输出目录过于敏感，拒绝自动修改权限: {output_root}"]
    if not output_root.exists():
        return [f"输出目录尚不存在，无法直接修改 ACL: {output_root}"]
    if not output_root.is_dir():
        return [f"output_root 不是文件夹，无法修复权限: {output_root}"]

    identity = _current_windows_identity()
    diagnostics: list[str] = [f"尝试为当前用户修复输出目录权限: {output_root}"]

    # 先确保继承权限开启，再授予当前用户 Modify 权限。Modify 足够创建、改写和删除本次产物。
    commands = [
        ["icacls", str(output_root), "/inheritance:e"],
        ["icacls", str(output_root), "/grant", f"{identity}:(OI)(CI)M", "/T", "/C"],
    ]
    direct_repair_ok = True
    for command in commands:
        ok, output = _run_repair_command(command)
        diagnostics.append(f"{'成功' if ok else '失败'}: {' '.join(command)}")
        if output:
            diagnostics.append(output)
        if not ok:
            direct_repair_ok = False
            break

    if not direct_repair_ok:
        diagnostics.append(
            "普通权限修复失败，已跳过 UAC 提权修复。"
            "请手动为该输出目录授予当前用户写入权限，或改用项目 outputs 目录。"
        )
    return diagnostics


def _write_text_file(
    path: Path,
    content: str,
    mode: str,
    encoding: str,
    mkdir: bool,
    atomic: bool,
) -> None:
    if mkdir:
        path.parent.mkdir(parents=True, exist_ok=True)

    if mode == "append":
        with open(path, "a", encoding=encoding) as f:
            f.write(content)
        return

    if atomic:
        atomic_write_bytes(path, content.encode(encoding))
    else:
        path.write_text(content, encoding=encoding)


def _write_bytes_file(
    path: Path,
    data: bytes,
    mode: str,
    mkdir: bool,
    atomic: bool,
) -> None:
    if mkdir:
        path.parent.mkdir(parents=True, exist_ok=True)

    if mode == "append":
        with open(path, "ab") as f:
            f.write(data)
        return

    if atomic:
        atomic_write_bytes(path, data)
    else:
        path.write_bytes(data)


async def execute(params: dict[str, Any]) -> Any:
    path_str: str = params.get("path", "")
    content: str = params.get("content", "")
    if not path_str:
        raise ValueError("缺少必填参数 path")

    allow_outside_roots: bool = params.get("allow_outside_roots", False)
    # H1：路径沙箱校验（防路径穿越与任意目录创建）
    # 用户在画布中明确配置输出目录时，Runner 会为 file-write 传入 allow_outside_roots。
    path = resolve_safe_path(path_str, allow_outside_roots=allow_outside_roots)

    binary_b64: bool = bool(params.get("binary_b64", False))
    payload_bytes: bytes | None = None
    if binary_b64:
        try:
            payload_bytes = base64.b64decode(content, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("binary_b64=true 时 content 必须是合法的 base64 字符串") from exc
        if len(payload_bytes) > MAX_CONTENT_SIZE:
            raise ValueError(f"二进制内容超过 {MAX_CONTENT_SIZE // 1024 // 1024} MB 上限")
    else:
        # 内容大小限制
        if len(content.encode("utf-8", errors="replace")) > MAX_CONTENT_SIZE:
            raise ValueError(f"content 超过 {MAX_CONTENT_SIZE // 1024 // 1024} MB 上限")

    mode: str = params.get("mode", "overwrite")
    encoding: str = params.get("encoding", "utf-8")
    mkdir: bool = params.get("mkdir", True)
    atomic: bool = params.get("atomic", True)
    output_root: str | None = params.get("output_root")
    permission_repaired = False
    repair_diagnostics: list[str] = []

    def _do_write() -> None:
        if binary_b64:
            _write_bytes_file(path, payload_bytes or b"", mode, mkdir, atomic)
        else:
            _write_text_file(path, content, mode, encoding, mkdir, atomic)

    try:
        _do_write()
    except PermissionError as first_error:
        if allow_outside_roots:
            try:
                repair_diagnostics = _repair_windows_output_permissions(
                    path,
                    output_root,
                )
                _do_write()
                permission_repaired = True
            except PermissionError as second_error:
                detail = "\n".join(repair_diagnostics)
                raise PermissionError(
                    f"输出目录仍然无法写入: {path.parent}。\n"
                    f"软件已经尝试自动修复所选输出目录权限，但重试写入仍失败。\n"
                    f"诊断信息:\n{detail}"
                ) from second_error
            except Exception as repair_error:
                detail = "\n".join(repair_diagnostics)
                raise PermissionError(
                    f"输出目录无法写入: {path.parent}。\n"
                    f"软件尝试自动修复权限时失败: {repair_error}\n"
                    f"诊断信息:\n{detail}"
                ) from repair_error
        else:
            raise PermissionError(
                f"输出目录没有写入权限: {path.parent}。"
            ) from first_error

    return {
        "path": str(path),
        "mode": mode,
        "written": len(payload_bytes) if binary_b64 and payload_bytes is not None else len(content.encode(encoding)),
        "atomic": atomic,
        "permission_repaired": permission_repaired,
        "repair_diagnostics": repair_diagnostics,
    }
