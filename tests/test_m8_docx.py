from pathlib import Path

from docx import Document
from PIL import Image

from engine.m8_docx import build_docx

ARTICLE = {
    "pages": [
        {"subhead": "Intro", "image": "00_00_01", "body": "Para one.\n\nPara two."},
        {"subhead": "Missing pic", "image": "09_59_59", "body": "Body.",
         "notes_zh": "中文说明不应出现在 docx 里"},
    ],
    "meta": {
        "titles": ["Best Title", "Alt Title"],
        "keywords": ["k1", "k2"],
        "description": "The description.",
    },
}


def _make_hd(d: Path, name: str) -> None:
    Image.new("RGB", (1280, 720), "blue").save(d / f"{name}.jpg", "JPEG")


def test_build_docx(tmp_path: Path):
    hd = tmp_path / "01_hd"
    hd.mkdir()
    _make_hd(hd, "00_00_01")
    out = tmp_path / "article_final.docx"

    warnings = build_docx(ARTICLE, hd_dir=hd, out_path=out)

    assert out.is_file()
    assert any("09_59_59" in w for w in warnings)  # 缺图给警告而非崩溃

    doc = Document(str(out))
    texts = [p.text for p in doc.paragraphs]
    headings = [p.text for p in doc.paragraphs if p.style.name.startswith("Heading")]
    assert "Intro" in headings and "Missing pic" in headings
    assert "Para one." in texts and "Para two." in texts
    assert any("Best Title" in t for t in texts)        # 文末 meta
    assert any("k1, k2" in t for t in texts)
    assert any("The description." in t for t in texts)
    assert not any("中文说明" in t for t in texts)       # notes_zh 不进正文
    assert len(doc.inline_shapes) == 1                   # 只有存在的那张图


def test_build_docx_image_centered(tmp_path: Path):
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    hd = tmp_path / "hd"
    hd.mkdir()
    _make_hd(hd, "00_00_01")
    out = tmp_path / "a.docx"
    build_docx(
        {"pages": [ARTICLE["pages"][0]], "meta": ARTICLE["meta"]}, hd, out
    )
    doc = Document(str(out))
    pic_paras = [
        p for p in doc.paragraphs
        if p._p.xpath(".//*[local-name()='drawing']")
    ]
    assert pic_paras and pic_paras[0].alignment == WD_ALIGN_PARAGRAPH.CENTER
