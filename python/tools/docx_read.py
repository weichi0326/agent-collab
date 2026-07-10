"""
docx-read 工具：从 Word .docx 文档中提取正文与表格文本。
params:
  path   (str, 必填) docx 文件绝对路径（须在允许根目录内）
  action (str, 可选) "text"（默认）| "meta"
"""
from pathlib import Path
from typing import Any
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from tools.sandbox import resolve_safe_path

MAX_DOCX_SIZE = 50 * 1024 * 1024
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def _node_text(node: ElementTree.Element) -> str:
    return "".join(t.text or "" for t in node.findall(".//w:t", NS)).strip()


def _extract_document_text(path: Path) -> str:
    try:
        with ZipFile(path) as zf:
            raw = zf.read("word/document.xml")
    except KeyError as exc:
        raise ValueError("docx 文件缺少 word/document.xml，无法读取正文") from exc
    except BadZipFile as exc:
        raise ValueError("文件不是有效的 docx 文档") from exc

    root = ElementTree.fromstring(raw)
    blocks: list[str] = []

    body = root.find("w:body", NS)
    if body is None:
        return ""

    for child in body:
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            text = _node_text(child)
            if text:
                blocks.append(text)
        elif tag == "tbl":
            rows: list[str] = []
            for row in child.findall(".//w:tr", NS):
                cells = [_node_text(cell) for cell in row.findall("./w:tc", NS)]
                if any(cells):
                    rows.append(" | ".join(cells))
            if rows:
                blocks.append("\n".join(rows))

    return "\n\n".join(blocks)


async def execute(params: dict[str, Any]) -> Any:
    path_str: str = params.get("path", "")
    if not path_str:
        raise ValueError("缺少必填参数 path")

    path = resolve_safe_path(path_str)
    if not path.exists():
        raise FileNotFoundError(f"文件不存在: {path}")
    if not path.is_file():
        raise ValueError(f"路径不是文件: {path}")
    if path.suffix.lower() != ".docx":
        raise ValueError("docx-read 仅支持 .docx 文件")
    if path.stat().st_size > MAX_DOCX_SIZE:
        raise ValueError(f"docx 文件超过 {MAX_DOCX_SIZE // 1024 // 1024} MB 上限")

    action: str = params.get("action", "text")
    if action == "meta":
        stat = path.stat()
        return {
            "name": path.name,
            "size": stat.st_size,
            "modified": stat.st_mtime,
            "created": stat.st_ctime,
        }
    if action != "text":
        raise ValueError(f"未知 action: {action}")

    content = _extract_document_text(path)
    return {"content": content, "size": path.stat().st_size}
