import json
from pathlib import Path

from PIL import Image, ImageDraw

from engine.m5_select import select_representatives, write_manifest


def _make_frame(path: Path, kind: str) -> None:
    img = Image.new("RGB", (640, 360), "white")
    draw = ImageDraw.Draw(img)
    if kind == "checker":
        for x in range(0, 640, 40):
            for y in range(0, 360, 40):
                if (x // 40 + y // 40) % 2 == 0:
                    draw.rectangle([x, y, x + 40, y + 40], fill="black")
    elif kind == "stripes":
        for x in range(0, 640, 20):
            draw.rectangle([x, 0, x + 10, 360], fill="black")
    img.save(path, "WEBP")


def test_select_keeps_first_and_distinct(tmp_path: Path):
    # 3 张白色 → 1 张棋盘 → 2 张竖纹：应选出 3 张代表帧
    kinds = ["white", "white", "white", "checker", "stripes", "stripes"]
    for i, kind in enumerate(kinds):
        _make_frame(tmp_path / f"00_00_0{i}.webp", kind)
    kept = select_representatives(tmp_path, threshold=10)
    assert kept[0] == "00_00_00"
    assert "00_00_03" in kept
    assert "00_00_04" in kept
    assert len(kept) == 3


def test_threshold_zero_keeps_all(tmp_path: Path):
    for i in range(3):
        _make_frame(tmp_path / f"00_00_0{i}.webp", "white")
    assert len(select_representatives(tmp_path, threshold=0)) == 3


def test_write_manifest(tmp_path: Path):
    out = tmp_path / "representatives.json"
    write_manifest(out, ["00_00_00", "00_00_03"], threshold=15)
    data = json.loads(out.read_text())
    assert data["threshold"] == 15
    assert data["frames"] == ["00_00_00", "00_00_03"]
