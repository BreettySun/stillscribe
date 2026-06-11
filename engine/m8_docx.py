"""M8 文档组装：读 M7 JSON，python-docx 一次性生成 article_final.docx。

每页：Heading 2 小标题 → HD 配图（6 英寸宽等比居中）→ 正文段落。
文末：meta（候选标题 / 关键词 / 描述）。notes_zh / analysis_zh 不进正文。
缺图：记 warning 跳过，不中断。
"""
from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches


def build_docx(article: dict, hd_dir: Path, out_path: Path) -> list[str]:
    warnings: list[str] = []
    doc = Document()

    for page in article["pages"]:
        doc.add_heading(page["subhead"], level=2)
        img = hd_dir / f"{page['image']}.jpg"
        if img.is_file():
            para = doc.add_paragraph()
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            para.add_run().add_picture(str(img), width=Inches(6))
        else:
            warnings.append(f"配图缺失，已跳过: {page['image']} (页 {page['subhead']!r})")
        for chunk in page["body"].split("\n\n"):
            if chunk.strip():
                doc.add_paragraph(chunk.strip())

    meta = article["meta"]
    doc.add_heading("Meta", level=2)
    doc.add_paragraph("Titles: " + " | ".join(meta["titles"]))
    doc.add_paragraph("Keywords: " + ", ".join(meta["keywords"]))
    doc.add_paragraph("Description: " + meta["description"])

    doc.save(str(out_path))
    return warnings
