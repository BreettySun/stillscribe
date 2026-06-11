from pathlib import Path

import pytest

from engine.paths import TaskDir, name_to_seconds, seconds_to_name, slugify_title


def test_seconds_to_name():
    assert seconds_to_name(0) == "00_00_00"
    assert seconds_to_name(75) == "00_01_15"
    assert seconds_to_name(3725) == "01_02_05"


def test_name_to_seconds_roundtrip():
    for s in (0, 59, 60, 3599, 3600, 7325):
        assert name_to_seconds(seconds_to_name(s)) == s


def test_slugify_title():
    assert slugify_title("Hello World: A/B Test!") == "Hello_World_A_B_Test"
    assert slugify_title("中文 标题") == "中文_标题"
    assert len(slugify_title("x" * 200)) <= 50


def test_taskdir_layout(tmp_path: Path):
    td = TaskDir.create(tmp_path, video_id="abc123XYZ_-", title="My Video")
    assert td.root == tmp_path / "abc123XYZ_-_My_Video"
    assert td.source.is_dir()
    assert td.hd.name == "01_hd"
    assert td.webp.name == "02_webp"
    assert td.grids.name == "03_grids"
    assert td.article_dir.name == "article"
    assert td.clips.name == "mp4_clips"
    assert td.task_json == td.root / "task.json"
    assert td.representatives_json == td.root / "representatives.json"
    assert td.article_json == td.article_dir / "article.json"
    assert td.prompt_txt == td.article_dir / "prompt.txt"
    assert td.docx == td.article_dir / "article_final.docx"


def test_taskdir_create_is_idempotent(tmp_path: Path):
    td1 = TaskDir.create(tmp_path, video_id="id1", title="T")
    (td1.source / "marker.txt").write_text("x")
    td2 = TaskDir.create(tmp_path, video_id="id1", title="T")
    assert (td2.source / "marker.txt").read_text() == "x"
