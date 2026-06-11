"""M2 下载：yt-dlp 封装。默认 1080p（<= 防无对应分辨率失败）、英文人工+自动字幕转 srt。"""
from __future__ import annotations

from pathlib import Path

from engine.config import tool_path
from engine.shell import run_cmd


def build_info_args(url: str, browser: str | None = None) -> list[str]:
    args = [
        str(tool_path("yt-dlp")),
        "--no-playlist",
        "--print", "%(id)s\t%(title)s",
        "--skip-download",
    ]
    if browser:
        args += ["--cookies-from-browser", browser]
    args.append(url)
    return args


def fetch_video_info(url: str, browser: str | None = None) -> tuple[str, str]:
    """返回 (video_id, title)，下载前先取，用于创建任务目录。"""
    result = run_cmd(build_info_args(url, browser), timeout=120)
    video_id, title = result.stdout.strip().split("\t", 1)
    return video_id, title


def build_download_args(
    url: str, dest: Path, quality: int = 1080, browser: str | None = None
) -> list[str]:
    args = [
        str(tool_path("yt-dlp")),
        "--no-playlist",
        "-f", f"bv*[height<={quality}]+ba/b[height<={quality}]",
        "--merge-output-format", "mp4",
        "--write-subs", "--write-auto-subs",
        # 只要原生/自动英文轨；"en.*" 会把全部 en-XX 翻译轨拉下来（50+ 次多余请求）
        "--sub-langs", "en,en-orig",
        "--convert-subs", "srt",
        "-o", str(dest / "%(title).80s [%(id)s].%(ext)s"),
    ]
    if browser:
        args += ["--cookies-from-browser", browser]
    args.append(url)
    return args


def find_outputs(source_dir: Path) -> tuple[Path, Path | None]:
    """在 source/ 找下载产物。返回 (mp4, srt 或 None)。"""
    mp4s = sorted(source_dir.glob("*.mp4"))
    if not mp4s:
        raise FileNotFoundError(
            f"{source_dir} 下没有 mp4。常见原因：网络问题 / 需要 cookie"
            "（加 --browser safari 或 chrome）/ 完全磁盘访问权限未授予。"
        )
    # 优先纯 .en.srt（人工/原生轨），en-XX 的自动翻译轨次之
    srts = sorted(
        source_dir.glob("*.srt"),
        key=lambda p: (0 if p.name.endswith(".en.srt") else 1, p.name),
    )
    return mp4s[0], (srts[0] if srts else None)


def download(
    url: str, source_dir: Path, quality: int = 1080, browser: str | None = None
) -> tuple[Path, Path | None]:
    """幂等：source/ 已有 mp4 则直接返回，不重复下载。"""
    existing = sorted(source_dir.glob("*.mp4"))
    if existing:
        return find_outputs(source_dir)
    run_cmd(build_download_args(url, source_dir, quality, browser), timeout=3600)
    return find_outputs(source_dir)
