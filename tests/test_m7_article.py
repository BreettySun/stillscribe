import json
from pathlib import Path

import pytest

from engine.m7_article import parse_article_text, prepare_materials, validate_article

GOOD = {
    "pages": [
        {"subhead": "Intro", "image": "00_00_05", "body": "Some text."},
        {"subhead": "Main", "image": "00_01_15", "body": "More.", "notes_zh": "说明"},
    ],
    "meta": {
        "titles": ["Title A", "Title B"],
        "keywords": ["k1", "k2"],
        "description": "Desc.",
    },
}


def test_validate_good():
    assert validate_article(GOOD) == []


def test_validate_catches_errors():
    bad = {
        "pages": [{"subhead": "x", "image": "0:00:05", "body": ""}],
        "meta": {"titles": [], "keywords": "k", "description": ""},
    }
    errors = validate_article(bad)
    assert any("image" in e for e in errors)      # 非 HH_MM_SS
    assert any("titles" in e for e in errors)     # 空列表
    assert any("keywords" in e for e in errors)   # 不是列表


def test_validate_missing_pages():
    assert any("pages" in e for e in validate_article({"meta": GOOD["meta"]}))


def test_parse_article_text_strips_fences():
    text = "```json\n" + json.dumps(GOOD) + "\n```"
    assert parse_article_text(text)["pages"][0]["image"] == "00_00_05"


def test_parse_article_text_plain():
    assert parse_article_text(json.dumps(GOOD))["meta"]["description"] == "Desc."


def test_parse_article_text_invalid_raises():
    with pytest.raises(ValueError, match="JSON"):
        parse_article_text("not json at all")


def test_prepare_materials(tmp_path: Path):
    template = tmp_path / "tpl.md"
    template.write_text("PROMPT HEAD\n{{SUBTITLES}}\nTAIL", encoding="utf-8")
    srt = tmp_path / "v.en.srt"
    srt.write_text("1\n00:00:00,000 --> 00:00:01,000\nhello world\n", encoding="utf-8")
    out = tmp_path / "prompt.txt"

    prepare_materials(template, srt, out)

    text = out.read_text(encoding="utf-8")
    assert "PROMPT HEAD" in text and "hello world" in text and "{{SUBTITLES}}" not in text


def test_prepare_materials_no_srt(tmp_path: Path):
    template = tmp_path / "tpl.md"
    template.write_text("HEAD\n{{SUBTITLES}}", encoding="utf-8")
    out = tmp_path / "prompt.txt"
    prepare_materials(template, None, out)
    assert "无字幕" in out.read_text(encoding="utf-8")
