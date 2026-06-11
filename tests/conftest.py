from pathlib import Path

import pytest

from engine.config import tool_path
from engine.shell import run_cmd


@pytest.fixture(scope="session")
def sample_video(tmp_path_factory) -> Path:
    """5 秒 1280x720 测试视频（testsrc 画面带帧计数，便于肉眼核对）。"""
    out = tmp_path_factory.mktemp("video") / "sample.mp4"
    run_cmd([
        str(tool_path("ffmpeg")), "-y",
        "-f", "lavfi", "-i", "testsrc=duration=5:size=1280x720:rate=30",
        "-pix_fmt", "yuv420p",
        str(out),
    ])
    return out
