"""
docx-write tool: create a simple Word .docx document from structured JSON.

The implementation writes the minimal Office Open XML package with stdlib only,
so it does not require python-docx to be installed in the user's environment.
"""
from __future__ import annotations

from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile

from tools.sandbox import resolve_safe_path


def _xml(value: Any) -> str:
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _paragraph(text: Any, style: str | None = None) -> str:
    style_xml = f'<w:pStyle w:val="{style}"/>' if style else ""
    return (
        "<w:p>"
        f"<w:pPr>{style_xml}</w:pPr>"
        "<w:r>"
        f"<w:t xml:space=\"preserve\">{_xml(text)}</w:t>"
        "</w:r>"
        "</w:p>"
    )


def _cell(text: Any) -> str:
    return (
        "<w:tc>"
        "<w:tcPr><w:tcW w:w=\"2400\" w:type=\"dxa\"/></w:tcPr>"
        f"{_paragraph(text)}"
        "</w:tc>"
    )


def _table(table: dict[str, Any]) -> str:
    headers = table.get("headers")
    rows = table.get("rows")
    row_items: list[list[Any]] = []
    if isinstance(headers, list) and headers:
        row_items.append(headers)
    if isinstance(rows, list):
        for row in rows:
            row_items.append(row if isinstance(row, list) else [row])
    if not row_items:
        return ""

    tr_xml = "".join(
        "<w:tr>" + "".join(_cell(cell) for cell in row) + "</w:tr>"
        for row in row_items
    )
    return (
        "<w:tbl>"
        "<w:tblPr>"
        "<w:tblW w:w=\"0\" w:type=\"auto\"/>"
        "<w:tblBorders>"
        "<w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"D8DEE6\"/>"
        "<w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"D8DEE6\"/>"
        "<w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"D8DEE6\"/>"
        "<w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"D8DEE6\"/>"
        "<w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"D8DEE6\"/>"
        "<w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"D8DEE6\"/>"
        "</w:tblBorders>"
        "</w:tblPr>"
        f"{tr_xml}"
        "</w:tbl>"
    )


def _document_xml(title: str, sections: list[Any], fallback_content: str) -> str:
    body: list[str] = [_paragraph(title, "Title")]
    valid_sections = [s for s in sections if isinstance(s, dict)]
    if not valid_sections:
        valid_sections = [{"heading": "", "paragraphs": [fallback_content]}]

    for section in valid_sections:
        heading = section.get("heading")
        if heading:
            body.append(_paragraph(heading, "Heading1"))
        paragraphs = section.get("paragraphs")
        if isinstance(paragraphs, list):
            for item in paragraphs:
                if str(item or "").strip():
                    body.append(_paragraph(item))
        table = section.get("table")
        if isinstance(table, dict):
            table_xml = _table(table)
            if table_xml:
                body.append(table_xml)

    body.append("<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\"/></w:sectPr>")
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body>"
        + "".join(body)
        + "</w:body></w:document>"
    )


CONTENT_TYPES_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"""

RELS_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

STYLES_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>"""


async def execute(params: dict[str, Any]) -> Any:
    path_str = params.get("path", "")
    if not path_str:
        raise ValueError("缺少必填参数 path")

    allow_outside_roots = bool(params.get("allow_outside_roots", False))
    path = resolve_safe_path(path_str, allow_outside_roots=allow_outside_roots)
    if path.suffix.lower() != ".docx":
        path = path.with_suffix(".docx")

    title = str(params.get("title") or path.stem)
    sections = params.get("sections")
    if not isinstance(sections, list):
        sections = []
    fallback_content = str(params.get("content") or "")

    path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(path, "w", ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", CONTENT_TYPES_XML)
        docx.writestr("_rels/.rels", RELS_XML)
        docx.writestr("word/document.xml", _document_xml(title, sections, fallback_content))
        docx.writestr("word/styles.xml", STYLES_XML)

    return {"path": str(path), "sections": len(sections)}
