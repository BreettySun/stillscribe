"""目录结构与 HH_MM_SS 命名约定 — 全项目唯一定义处（架构文档第 7 节）。"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

_NAME_RE = re.compile(r"^(\d{2})_(\d{2})_(\d{2})$")


def seconds_to_name(seconds: int) -> str:
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}_{m:02d}_{s:02d}"


def name_to_seconds(name: str) -> int:
    m = _NAME_RE.match(name)
    if not m:
        raise ValueError(f"不是合法的 HH_MM_SS 名称: {name!r}")
    h, mi, s = (int(g) for g in m.groups())
    return h * 3600 + mi * 60 + s


def slugify_title(title: str, max_len: int = 50) -> str:
    slug = re.sub(r"[^\w一-鿿]+", "_", title, flags=re.UNICODE).strip("_")
    return slug[:max_len].rstrip("_")


@dataclass(frozen=True)
class TaskDir:
    root: Path

    @classmethod
    def create(cls, workroot: Path, video_id: str, title: str) -> "TaskDir":
        td = cls(Path(workroot) / f"{video_id}_{slugify_title(title)}")
        for d in (td.source, td.hd, td.webp, td.grids, td.article_dir, td.clips):
            d.mkdir(parents=True, exist_ok=True)
        return td

    @property
    def source(self) -> Path:
        return self.root / "source"

    @property
    def hd(self) -> Path:
        return self.root / "01_hd"

    @property
    def webp(self) -> Path:
        return self.root / "02_webp"

    @property
    def grids(self) -> Path:
        return self.root / "03_grids"

    @property
    def article_dir(self) -> Path:
        return self.root / "article"

    @property
    def clips(self) -> Path:
        return self.root / "mp4_clips"

    @property
    def task_json(self) -> Path:
        return self.root / "task.json"

    @property
    def representatives_json(self) -> Path:
        return self.root / "representatives.json"

    @property
    def article_json(self) -> Path:
        return self.article_dir / "article.json"

    @property
    def prompt_txt(self) -> Path:
        return self.article_dir / "prompt.txt"

    @property
    def docx(self) -> Path:
        return self.article_dir / "article_final.docx"
