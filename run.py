"""命令行入口。

新任务:  uv run python run.py <youtube_url> [--mode auto|manual] [--quality 1080]
                                            [--browser safari|chrome] [--threshold 15]
                                            [--workroot ./workspace]
续跑:    uv run python run.py --task-dir <dir> --from <step> [--to <step>]
步骤:    download frames select grids article docx
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from engine.m2_download import fetch_video_info
from engine.paths import TaskDir
from engine.pipeline import STEP_NAMES, default_steps, run_steps


def main() -> None:
    parser = argparse.ArgumentParser(description="视频生成图文文章 — P1 命令行引擎")
    parser.add_argument("url", nargs="?", help="YouTube URL（新任务）")
    parser.add_argument("--task-dir", help="已有任务目录（续跑）")
    parser.add_argument("--from", dest="from_step", choices=STEP_NAMES)
    parser.add_argument("--to", dest="stop_after", choices=STEP_NAMES)
    parser.add_argument("--mode", choices=["manual", "auto"], default="manual")
    parser.add_argument("--quality", type=int, choices=[1080, 1440], default=1080)
    parser.add_argument("--browser", choices=["safari", "chrome", "firefox"])
    parser.add_argument("--threshold", type=int, default=15, help="phash 去重阈值")
    parser.add_argument("--workroot", default="workspace")
    args = parser.parse_args()

    if bool(args.url) == bool(args.task_dir):
        parser.error("URL 和 --task-dir 二选一")

    if args.task_dir:
        td = TaskDir(Path(args.task_dir).resolve())
        if not td.task_json.is_file():
            sys.exit(f"不是任务目录（缺 task.json）: {td.root}")
        url = json.loads(td.task_json.read_text(encoding="utf-8")).get("url", "")
        from_step = args.from_step or "download"
    else:
        video_id, title = fetch_video_info(args.url, browser=args.browser)
        td = TaskDir.create(Path(args.workroot).resolve(), video_id, title)
        url = args.url
        if not td.task_json.is_file():
            td.task_json.write_text(
                json.dumps(
                    {
                        "url": url, "video_id": video_id, "title": title,
                        "quality": args.quality, "threshold": args.threshold,
                        "created_at": datetime.now().isoformat(timespec="seconds"),
                        "steps": {},
                    },
                    ensure_ascii=False, indent=2,
                ),
                encoding="utf-8",
            )
        print(f"任务目录: {td.root}")
        from_step = args.from_step

    api_key = os.environ.get("GEMINI_API_KEY")
    if args.mode == "auto" and not api_key:
        sys.exit("--mode auto 需要环境变量 GEMINI_API_KEY")

    steps = default_steps(
        url,
        quality=args.quality,
        browser=args.browser,
        threshold=args.threshold,
        mode=args.mode,
        api_key=api_key,
        gemini_model=os.environ.get("GEMINI_MODEL", "gemini-2.5-pro"),
    )
    run_steps(td, steps, from_step=from_step, stop_after=args.stop_after)


if __name__ == "__main__":
    main()
