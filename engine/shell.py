"""subprocess 封装：统一日志、超时与错误信息（带 stderr 尾部）。"""
from __future__ import annotations

import subprocess
import sys


def run_cmd(args: list[str], timeout: int | None = None) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(str(a) for a in args)}", file=sys.stderr)
    result = subprocess.run(
        [str(a) for a in args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        tail = "\n".join(result.stderr.strip().splitlines()[-20:])
        raise RuntimeError(
            f"命令失败 (exit {result.returncode}): {args[0]}\n--- stderr 尾部 ---\n{tail}"
        )
    return result
