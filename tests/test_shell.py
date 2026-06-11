import pytest

from engine.shell import run_cmd


def test_run_cmd_success():
    result = run_cmd(["/bin/echo", "hello"])
    assert result.returncode == 0
    assert "hello" in result.stdout


def test_run_cmd_failure_raises_with_stderr():
    with pytest.raises(RuntimeError, match="No such file"):
        run_cmd(["/bin/cat", "/nonexistent/file/xyz"])
