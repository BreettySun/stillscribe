"""M5 去重选帧：phash 在 640 webp 全集上挑代表帧清单（仅服务于喂 Gemini）。

逐秒全集不动；与上一张**已保留**的代表帧距离 >= threshold 才保留。
"""
from __future__ import annotations

import json
from pathlib import Path

import imagehash
from PIL import Image


def select_representatives(webp_dir: Path, threshold: int = 15) -> list[str]:
    """返回保留帧的名字列表（无扩展名，HH_MM_SS，按时间序）。"""
    names = sorted(p.stem for p in webp_dir.glob("*.webp"))
    kept: list[str] = []
    last_hash = None
    for name in names:
        with Image.open(webp_dir / f"{name}.webp") as img:
            h = imagehash.phash(img)
        # threshold=0 时任何距离都 >= 0，等价于保留全部
        if last_hash is None or (h - last_hash) >= threshold:
            kept.append(name)
            last_hash = h
    return kept


def write_manifest(path: Path, frames: list[str], threshold: int) -> None:
    path.write_text(
        json.dumps({"threshold": threshold, "frames": frames}, indent=2),
        encoding="utf-8",
    )


def load_manifest(path: Path) -> list[str]:
    return json.loads(path.read_text(encoding="utf-8"))["frames"]
