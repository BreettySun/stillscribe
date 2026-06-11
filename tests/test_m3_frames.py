from pathlib import Path

from engine.m3_frames import build_hd_args, build_webp_args, generate_frames


def test_build_webp_args_contains_pipeline_pieces(tmp_path: Path):
    args = build_webp_args(Path("/v.mp4"), tmp_path)
    joined = " ".join(args)
    assert "fps=1" in joined
    assert "scale=640:360" in joined
    assert "drawtext" in joined
    assert "-frame_pts" in args
    assert joined.endswith("%d.webp")


def test_build_hd_args(tmp_path: Path):
    args = build_hd_args(Path("/v.mp4"), tmp_path)
    joined = " ".join(args)
    assert "fps=1" in joined and "scale=1280:720" in joined
    assert "drawtext" not in joined
    assert joined.endswith("%d.jpg")


def test_generate_frames_integration(sample_video: Path, tmp_path: Path):
    webp_dir = tmp_path / "02_webp"
    hd_dir = tmp_path / "01_hd"
    webp_dir.mkdir()
    hd_dir.mkdir()

    count = generate_frames(sample_video, webp_dir=webp_dir, hd_dir=hd_dir)

    webp_names = sorted(p.name for p in webp_dir.glob("*.webp"))
    hd_names = sorted(p.name for p in hd_dir.glob("*.jpg"))
    # 5 秒视频 fps=1 → 第 0..4 秒，共 5 帧（允许 ±1 帧封装误差）
    assert count == len(webp_names)
    assert 4 <= len(webp_names) <= 6
    assert webp_names[0] == "00_00_00.webp"
    assert "00_00_04.webp" in webp_names
    # 两个全集帧名一一对应（S2: 时间戳与文件名对齐）
    assert [n.removesuffix(".webp") for n in webp_names] == [
        n.removesuffix(".jpg") for n in hd_names
    ]


def test_generate_frames_idempotent(sample_video: Path, tmp_path: Path):
    webp_dir = tmp_path / "w"
    hd_dir = tmp_path / "h"
    webp_dir.mkdir()
    hd_dir.mkdir()
    c1 = generate_frames(sample_video, webp_dir=webp_dir, hd_dir=hd_dir)
    c2 = generate_frames(sample_video, webp_dir=webp_dir, hd_dir=hd_dir)
    assert c1 == c2
