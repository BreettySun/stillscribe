from pathlib import Path

from PIL import Image

from engine.m6_grids import build_grids


def _make_frames(d: Path, n: int) -> list[str]:
    names = []
    for i in range(n):
        name = f"00_00_{i:02d}" if i < 60 else f"00_01_{i - 60:02d}"
        Image.new("RGB", (640, 360), (i * 2 % 255, 100, 150)).save(
            d / f"{name}.webp", "WEBP"
        )
        names.append(name)
    return names


def test_build_grids_chunks_of_50(tmp_path: Path):
    webp = tmp_path / "02_webp"
    grids = tmp_path / "03_grids"
    webp.mkdir()
    grids.mkdir()
    names = _make_frames(webp, 60)  # 60 张 → 2 组宫格

    outputs = build_grids(webp_dir=webp, grids_dir=grids, frames=names)

    assert [p.name for p in outputs] == ["grid_001.jpg", "grid_002.jpg"]
    assert all(p.is_file() and p.stat().st_size > 0 for p in outputs)
    with Image.open(outputs[0]) as img:  # 10 列 × 5 行，单元 320x180 + 间隙
        assert img.width > 3000 and img.height > 800


def test_build_grids_idempotent(tmp_path: Path):
    webp = tmp_path / "w"
    grids = tmp_path / "g"
    webp.mkdir()
    grids.mkdir()
    names = _make_frames(webp, 5)
    out1 = build_grids(webp, grids, names)
    out2 = build_grids(webp, grids, names)
    assert out1 == out2
