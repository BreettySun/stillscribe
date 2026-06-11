import pytest

from engine.config import tool_path


def test_tool_path_returns_absolute(monkeypatch, tmp_path):
    fake = tmp_path / "ffmpeg"
    fake.write_text("#!/bin/sh\n")
    fake.chmod(0o755)
    monkeypatch.setenv("DIGGO_FFMPEG", str(fake))
    assert tool_path("ffmpeg") == fake


def test_tool_path_missing_tool_raises(monkeypatch, tmp_path):
    monkeypatch.setenv("DIGGO_FFMPEG", str(tmp_path / "nonexistent"))
    with pytest.raises(FileNotFoundError, match="ffmpeg"):
        tool_path("ffmpeg")


def test_unknown_tool_raises():
    with pytest.raises(KeyError):
        tool_path("notatool")
