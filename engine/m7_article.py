"""M7 文章生成：JSON 契约校验、容错解析、半自动素材准备、Gemini API 自动模式。

JSON 契约（架构文档 5.4，全项目唯一权威定义）：
{
  "pages": [{"subhead": str, "image": "HH_MM_SS", "body": str, "notes_zh"?: str}],
  "meta": {"titles": [str], "keywords": [str], "description": str},
  "analysis_zh"?: str
}
"""
from __future__ import annotations

import json
import re
from pathlib import Path

_IMAGE_RE = re.compile(r"^\d{2}_\d{2}_\d{2}$")


def validate_article(data: dict) -> list[str]:
    """返回错误列表；空列表 = 合法。"""
    errors: list[str] = []
    pages = data.get("pages")
    if not isinstance(pages, list) or not pages:
        errors.append("pages 必须是非空列表")
    else:
        for i, page in enumerate(pages):
            for key in ("subhead", "body"):
                if not isinstance(page.get(key), str) or not page.get(key):
                    errors.append(f"pages[{i}].{key} 必须是非空字符串")
            img = page.get("image", "")
            if not isinstance(img, str) or not _IMAGE_RE.match(img):
                errors.append(f"pages[{i}].image 必须是 HH_MM_SS 格式，got {img!r}")
    meta = data.get("meta")
    if not isinstance(meta, dict):
        errors.append("缺少 meta 对象")
    else:
        for key in ("titles", "keywords"):
            v = meta.get(key)
            if not isinstance(v, list) or not v:
                errors.append(f"meta.{key} 必须是非空列表")
        if not isinstance(meta.get("description"), str) or not meta.get("description"):
            errors.append("meta.description 必须是非空字符串")
    return errors


def parse_article_text(text: str) -> dict:
    """容错解析：剥 ```json 围栏、截取首尾花括号之间内容，再校验契约。"""
    stripped = text.strip()
    stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
    stripped = re.sub(r"\s*```$", "", stripped)
    start, end = stripped.find("{"), stripped.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"文本中找不到 JSON 对象:\n{text[:200]}")
    try:
        data = json.loads(stripped[start : end + 1])
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 解析失败: {e}") from e
    errors = validate_article(data)
    if errors:
        raise ValueError("JSON 不符合契约:\n" + "\n".join(errors))
    return data


def prepare_materials(template: Path, srt: Path | None, out: Path) -> None:
    """半自动模式：把 Prompt 模板 + 字幕拼成 article/prompt.txt 供人工粘贴。"""
    subtitles = (
        srt.read_text(encoding="utf-8", errors="replace") if srt else "（本视频无字幕）"
    )
    out.write_text(
        template.read_text(encoding="utf-8").replace("{{SUBTITLES}}", subtitles),
        encoding="utf-8",
    )
