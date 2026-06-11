"""外部 CLI 工具的绝对路径。统一从这里取，禁止依赖 PATH（P4 打包后 Finder 启动只有精简 PATH）。

覆盖方式：环境变量 DIGGO_<TOOL大写>，如 DIGGO_FFMPEG=/path/to/ffmpeg
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# 本机实测路径（2026-06：用 ffmpeg-full，keg-only 不软链进 /opt/homebrew/bin；
# 注意 brew 官方精简版 ffmpeg 不带 libwebp 编码器，M3 依赖 libwebp）
DEFAULT_TOOLS: dict[str, str] = {
    "ffmpeg": "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
    "ffprobe": "/opt/homebrew/opt/ffmpeg-full/bin/ffprobe",
    "montage": "/opt/homebrew/bin/montage",
    # yt-dlp 以 pip 包装进本项目 venv，绝对路径取自当前解释器前缀
    "yt-dlp": str(Path(sys.prefix) / "bin" / "yt-dlp"),
}


def tool_path(name: str) -> Path:
    if name not in DEFAULT_TOOLS:
        raise KeyError(f"未知工具: {name}")
    env_key = "DIGGO_" + name.upper().replace("-", "_")
    p = Path(os.environ.get(env_key, DEFAULT_TOOLS[name]))
    if not p.is_file():
        raise FileNotFoundError(
            f"找不到 {name}: {p}\n"
            f"请安装后用环境变量 {env_key} 指定绝对路径。"
        )
    return p
