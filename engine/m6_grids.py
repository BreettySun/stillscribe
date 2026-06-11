"""M6 宫格图：montage 把代表帧拼成 10×5=50 张/组（每格 320x180，水印随帧自带）。"""
from __future__ import annotations

from pathlib import Path

from engine.config import tool_path
from engine.shell import run_cmd

PER_GRID = 50
TILE = "10x5"
CELL = "320x180"


def build_grids(webp_dir: Path, grids_dir: Path, frames: list[str]) -> list[Path]:
    """frames 为 HH_MM_SS 名列表（来自 M5 manifest）。幂等：已有同名产物则跳过。"""
    outputs: list[Path] = []
    for i in range(0, len(frames), PER_GRID):
        chunk = frames[i : i + PER_GRID]
        out = grids_dir / f"grid_{i // PER_GRID + 1:03d}.jpg"
        outputs.append(out)
        if out.is_file():
            continue
        args = (
            [str(tool_path("montage"))]
            + [str(webp_dir / f"{n}.webp") for n in chunk]
            + ["-tile", TILE, "-geometry", f"{CELL}+2+2", "-background", "black", str(out)]
        )
        run_cmd(args, timeout=600)
    return outputs
