"""
pdf-read 工具：从 PDF 文件中提取文本、表格与元信息。
params:
  path       (str, 必填) PDF 文件绝对路径（须在允许根目录内）
  action     (str, 可选) "text"（默认）| "pages" | "tables" | "meta" | "images"
  start_page (int, 可选) 起始页（1-indexed，默认 1）
  end_page   (int, 可选) 结束页（默认最后一页）
  out_dir    (str, 可选) action=images 时的图片输出目录（须在允许根目录内）
"""
from typing import Any

from tools.sandbox import resolve_safe_path  # H1：路径沙箱

MAX_PDF_SIZE = 100 * 1024 * 1024  # 100 MB
MAX_IMAGES = 200
MAX_IMAGE_SIZE = 10 * 1024 * 1024

try:
    import fitz  # PyMuPDF
    _HAS_FITZ = True
except ImportError:
    _HAS_FITZ = False

try:
    import pdfplumber
    _HAS_PDFPLUMBER = True
except ImportError:
    _HAS_PDFPLUMBER = False


def _require_libs():
    if not _HAS_FITZ:
        raise ImportError("PyMuPDF 未安装，请运行 pip install PyMuPDF")


async def execute(params: dict[str, Any]) -> Any:
    _require_libs()

    path_str: str = params.get("path", "")
    if not path_str:
        raise ValueError("缺少必填参数 path")

    # H1：路径沙箱校验
    path = resolve_safe_path(path_str)
    if not path.exists():
        raise FileNotFoundError(f"文件不存在: {path}")

    # 文件大小限制
    if path.stat().st_size > MAX_PDF_SIZE:
        raise ValueError(f"PDF 文件超过 {MAX_PDF_SIZE // 1024 // 1024} MB 上限")

    action: str = params.get("action", "text")
    start_page: int = params.get("start_page", 1)

    # L20 修复：使用 with 语句确保 fitz.Document 被正确关闭
    with fitz.open(str(path)) as doc:
        total_pages = doc.page_count
        end_page: int = params.get("end_page", total_pages)

        # 页码范围转 0-indexed
        p0 = max(0, start_page - 1)
        p1 = min(total_pages, end_page)

        # ── 元信息 ─────────────────────────────────────────────
        if action == "meta":
            meta = doc.metadata
            return {
                "title": meta.get("title", ""),
                "author": meta.get("author", ""),
                "subject": meta.get("subject", ""),
                "creator": meta.get("creator", ""),
                "total_pages": total_pages,
            }

        # ── 全文 / 按页文本 ───────────────────────────────────
        if action in ("text", "pages"):
            pages_text = []
            for i in range(p0, p1):
                page = doc[i]
                pages_text.append({"page": i + 1, "text": page.get_text()})
            if action == "text":
                full_text = "\n".join(p["text"] for p in pages_text)
                return {"content": full_text, "pages": total_pages, "extracted_pages": len(pages_text)}
            return {"pages": pages_text, "total_pages": total_pages}

        # ── 表格提取（用 pdfplumber，精度更高） ────────────────
        if action == "tables":
            if not _HAS_PDFPLUMBER:
                raise ImportError("pdfplumber 未安装，请运行 pip install pdfplumber")
            result = []
            with pdfplumber.open(str(path)) as pdf:
                for i in range(p0, p1):
                    page = pdf.pages[i]
                    tables = page.extract_tables()
                    if tables:
                        result.append({"page": i + 1, "tables": tables})
            return {"tables_by_page": result, "pages_with_tables": len(result)}

        # ── 嵌入图片提取 ───────────────────────────────────────
        if action == "images":
            out_dir_str: str = params.get("out_dir", str(path.parent / "pdf_images"))
            # H1：out_dir 同样通过沙箱校验，防止写入任意目录
            out_dir = resolve_safe_path(out_dir_str)
            out_dir.mkdir(parents=True, exist_ok=True)
            saved = []
            for i in range(p0, p1):
                page = doc[i]
                for j, img in enumerate(page.get_images(full=True)):
                    if len(saved) >= MAX_IMAGES:
                        return {
                            "saved_images": saved,
                            "count": len(saved),
                            "out_dir": str(out_dir),
                            "truncated": True,
                        }
                    xref = img[0]
                    base_img = doc.extract_image(xref)
                    img_bytes = base_img["image"]
                    if len(img_bytes) > MAX_IMAGE_SIZE:
                        continue
                    ext = base_img["ext"]
                    out_file = out_dir / f"page{i+1}_img{j+1}.{ext}"
                    out_file.write_bytes(img_bytes)
                    saved.append(str(out_file))
            return {"saved_images": saved, "count": len(saved), "out_dir": str(out_dir)}

        raise ValueError(f"未知 action: {action}")
