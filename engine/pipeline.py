"""任务串联：固定步骤序列，状态写 task.json，支持 from-step / stop-after。"""
from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from engine.paths import TaskDir
from engine.m2_download import download, find_outputs
from engine.m3_frames import generate_frames
from engine.m5_select import load_manifest, select_representatives, write_manifest
from engine.m6_grids import build_grids
from engine.m7_article import call_gemini, parse_article_text, prepare_materials
from engine.m8_docx import build_docx

STEP_NAMES = ["download", "frames", "select", "grids", "article", "docx"]

PROMPT_TEMPLATE = Path(__file__).parent.parent / "prompts" / "article_prompt.md"


def _load_state(td: TaskDir) -> dict:
    if td.task_json.is_file():
        return json.loads(td.task_json.read_text(encoding="utf-8"))
    return {"steps": {}}


def _save_state(td: TaskDir, state: dict) -> None:
    state["updated_at"] = datetime.now().isoformat(timespec="seconds")
    td.task_json.write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def run_steps(
    td: TaskDir,
    steps: dict[str, Callable[[TaskDir], None]],
    from_step: str | None,
    stop_after: str | None = None,
) -> None:
    for name in (from_step, stop_after):
        if name is not None and name not in STEP_NAMES:
            raise ValueError(f"未知步骤: {name}（可选: {', '.join(STEP_NAMES)}）")
    start = STEP_NAMES.index(from_step) if from_step else 0
    state = _load_state(td)
    for name in STEP_NAMES[start:]:
        print(f"==> {name}")
        try:
            steps[name](td)
        except Exception:
            state["steps"][name] = "failed"
            _save_state(td, state)
            raise
        state["steps"][name] = "done"
        _save_state(td, state)
        if name == stop_after:
            break


def default_steps(
    url: str,
    quality: int = 1080,
    browser: str | None = None,
    threshold: int = 15,
    mode: str = "manual",
    api_key: str | None = None,
    gemini_model: str = "gemini-2.5-pro",
) -> dict[str, Callable[[TaskDir], None]]:
    def step_download(td: TaskDir) -> None:
        download(url, td.source, quality=quality, browser=browser)

    def step_frames(td: TaskDir) -> None:
        mp4, _srt = find_outputs(td.source)
        generate_frames(mp4, webp_dir=td.webp, hd_dir=td.hd)

    def step_select(td: TaskDir) -> None:
        kept = select_representatives(td.webp, threshold=threshold)
        write_manifest(td.representatives_json, kept, threshold)
        print(f"    代表帧 {len(kept)} / 全集 {len(list(td.webp.glob('*.webp')))}")

    def step_grids(td: TaskDir) -> None:
        build_grids(td.webp, td.grids, load_manifest(td.representatives_json))

    def step_article(td: TaskDir) -> None:
        _mp4, srt = find_outputs(td.source)
        prepare_materials(PROMPT_TEMPLATE, srt, td.prompt_txt)
        if td.article_json.is_file():  # 幂等：人工已回填则直接校验通过
            parse_article_text(td.article_json.read_text(encoding="utf-8"))
            return
        if mode == "auto":
            grids = sorted(td.grids.glob("grid_*.jpg"))
            data = call_gemini(
                td.prompt_txt.read_text(encoding="utf-8"),
                grids,
                api_key=api_key or "",
                model=gemini_model,
            )
            td.article_json.write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        else:
            raise SystemExit(
                "\n半自动模式：素材已就绪 ——\n"
                f"  1. Prompt: {td.prompt_txt}\n"
                f"  2. 宫格图: {td.grids}\n"
                "  把它们贴给 Gemini，将返回的 JSON 存为:\n"
                f"     {td.article_json}\n"
                "  然后续跑:\n"
                f"     uv run python run.py --task-dir '{td.root}' --from article\n"
            )

    def step_docx(td: TaskDir) -> None:
        article = parse_article_text(td.article_json.read_text(encoding="utf-8"))
        warnings = build_docx(article, hd_dir=td.hd, out_path=td.docx)
        for w in warnings:
            print(f"    [warn] {w}")
        print(f"    完成: {td.docx}")

    return {
        "download": step_download,
        "frames": step_frames,
        "select": step_select,
        "grids": step_grids,
        "article": step_article,
        "docx": step_docx,
    }
