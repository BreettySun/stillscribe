import json
from pathlib import Path

import pytest

from engine.paths import TaskDir
from engine.pipeline import STEP_NAMES, run_steps


def test_step_names_order():
    assert STEP_NAMES == ["download", "frames", "select", "grids", "article", "docx"]


def _taskdir(tmp_path: Path) -> TaskDir:
    return TaskDir.create(tmp_path, video_id="vid", title="T")


def test_run_steps_runs_all_and_records(tmp_path: Path):
    td = _taskdir(tmp_path)
    ran: list[str] = []
    steps = {name: (lambda n: lambda td: ran.append(n))(name) for name in STEP_NAMES}

    run_steps(td, steps, from_step=None)

    assert ran == STEP_NAMES
    state = json.loads(td.task_json.read_text())
    assert all(state["steps"][n] == "done" for n in STEP_NAMES)


def test_run_steps_from_step_skips_earlier(tmp_path: Path):
    td = _taskdir(tmp_path)
    ran: list[str] = []
    steps = {name: (lambda n: lambda td: ran.append(n))(name) for name in STEP_NAMES}

    run_steps(td, steps, from_step="grids")

    assert ran == ["grids", "article", "docx"]


def test_run_steps_failure_marks_and_raises(tmp_path: Path):
    td = _taskdir(tmp_path)

    def boom(td):
        raise RuntimeError("nope")

    steps = {name: (lambda td: None) for name in STEP_NAMES}
    steps["grids"] = boom

    with pytest.raises(RuntimeError, match="nope"):
        run_steps(td, steps, from_step=None)
    state = json.loads(td.task_json.read_text())
    assert state["steps"]["frames"] == "done"
    assert state["steps"]["grids"] == "failed"


def test_run_steps_stop_after(tmp_path: Path):
    td = _taskdir(tmp_path)
    ran: list[str] = []
    steps = {name: (lambda n: lambda td: ran.append(n))(name) for name in STEP_NAMES}

    run_steps(td, steps, from_step=None, stop_after="grids")

    assert ran == ["download", "frames", "select", "grids"]


def test_run_steps_unknown_from_step(tmp_path: Path):
    td = _taskdir(tmp_path)
    with pytest.raises(ValueError, match="未知步骤"):
        run_steps(td, {n: (lambda td: None) for n in STEP_NAMES}, from_step="nope")
