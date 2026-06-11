"""M3 帧生成（合并原 M3+M4）：每个全集一趟 ffmpeg，源视频直出成品帧。

- 02_webp: fps=1 + scale=640:360 + drawtext 时间戳水印 + libwebp
- 01_hd:   fps=1 + scale=1280:720 + jpg（python-docx 不支持 webp，HD 用 jpg）
- -frame_pts 1 使输出文件名 = pts 秒数，重命名为 HH_MM_SS 是纯算术映射
"""
from __future__ import annotations

from pathlib import Path

from engine.config import tool_path
from engine.paths import seconds_to_name
from engine.shell import run_cmd

# %{pts\:hms} 展开为 HH:MM:SS.mmm；fps=1 下毫秒恒为 000
_DRAWTEXT = (
    "drawtext=text='%{pts\\:hms}'"
    ":fontcolor=white:fontsize=28:x=12:y=12"
    ":box=1:boxcolor=black@0.5:boxborderw=6"
)


def build_webp_args(video: Path, out_dir: Path) -> list[str]:
    vf = f"fps=1,scale=640:360,{_DRAWTEXT}"
    return [
        str(tool_path("ffmpeg")), "-y", "-i", str(video),
        "-vf", vf,
        "-c:v", "libwebp", "-q:v", "80",
        "-frame_pts", "1",
        str(out_dir / "%d.webp"),
    ]


def build_hd_args(video: Path, out_dir: Path) -> list[str]:
    return [
        str(tool_path("ffmpeg")), "-y", "-i", str(video),
        "-vf", "fps=1,scale=1280:720",
        "-q:v", "2",
        "-frame_pts", "1",
        str(out_dir / "%d.jpg"),
    ]


def _rename_to_hhmmss(out_dir: Path, suffix: str) -> int:
    count = 0
    for p in sorted(out_dir.glob(f"*{suffix}")):
        if p.stem.isdigit():
            p.rename(out_dir / f"{seconds_to_name(int(p.stem))}{suffix}")
            count += 1
    return count


def generate_frames(video: Path, webp_dir: Path, hd_dir: Path) -> int:
    """幂等：两个目录都已有产物则跳过。返回 webp 帧数。"""
    existing = list(webp_dir.glob("*.webp"))
    if existing and list(hd_dir.glob("*.jpg")):
        return len(existing)

    run_cmd(build_webp_args(video, webp_dir), timeout=7200)
    _rename_to_hhmmss(webp_dir, ".webp")
    run_cmd(build_hd_args(video, hd_dir), timeout=7200)
    _rename_to_hhmmss(hd_dir, ".jpg")
    return len(list(webp_dir.glob("*.webp")))
