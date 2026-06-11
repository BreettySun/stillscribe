# P1 命令行引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `python run.py <youtube_url>` 一条龙跑完 M2→M8，输出带配图的 `article_final.docx`；每个模块幂等、产物落盘、可单步重跑。

**Architecture:** 纯 Python 包 `engine/`，每个模块（M2 下载 / M3 帧生成 / M5 去重选帧 / M6 宫格图 / M7 文章 JSON / M8 docx）是一个独立文件，`pipeline.py` 按步骤名串联并支持 `--from <step>` 重跑；所有外部 CLI（ffmpeg/yt-dlp/montage）经 `config.py` 以**绝对路径**调用（为 P4 打包提前规避最小 PATH 坑）。目录与 `HH_MM_SS` 命名约定集中在 `paths.py`（最难回改，最先定死）。

**Tech Stack:** Python 3.12（uv 管理）、imagehash、Pillow、python-docx、httpx、yt-dlp（pip 装进 venv 当 CLI 用）、pytest；外部二进制 ffmpeg/ffprobe（ffmpeg-full）、ImageMagick montage。

**环境实况（已探查，2026-06-11）：**
- ffmpeg/ffprobe 在 `/opt/homebrew/opt/ffmpeg-full/bin/`（**不在 PATH**）
- montage 在 `/opt/homebrew/bin/montage`
- 本机无 yt-dlp、无 uv，系统 Python 3.9.6（太旧）→ Task 1 装 uv + Python 3.12，yt-dlp 作为依赖装进 venv
- 本目录尚未 `git init`

**Spike 关系：** S2（一趟 ffmpeg 水印+时间戳对齐）由 Task 5 的集成测试直接验证；S1（Gemini 稳定吐 JSON）由 Task 8 半自动模式先行规避、Task 9 自动模式落地验证。S3（打包签名）不在本计划内。

**M7 JSON 契约（架构文档已定，全计划统一）：**

```json
{
  "pages": [
    { "subhead": "...", "image": "HH_MM_SS", "body": "...", "notes_zh": "可选：中文配图说明" }
  ],
  "meta": {
    "titles": ["...", "..."],
    "keywords": ["...", "..."],
    "description": "..."
  },
  "analysis_zh": "可选：中文文章框架说明，不进正文"
}
```

**最终文件结构：**

```
diggo-press/
├── pyproject.toml
├── run.py                      # CLI 入口
├── engine/
│   ├── __init__.py
│   ├── paths.py                # 目录/HH_MM_SS 命名约定（Task 2）
│   ├── config.py               # 外部工具绝对路径（Task 3）
│   ├── shell.py                # subprocess 封装（Task 3）
│   ├── m2_download.py          # yt-dlp（Task 4）
│   ├── m3_frames.py            # 一趟 ffmpeg 帧生成（Task 5）
│   ├── m5_select.py            # phash 去重选代表帧（Task 6）
│   ├── m6_grids.py             # montage 宫格图（Task 7）
│   ├── m7_article.py           # JSON 校验 + 半自动 + Gemini API（Task 8/9）
│   ├── m8_docx.py              # python-docx 程序化生成（Task 10）
│   └── pipeline.py             # 串联 + from-step（Task 11）
├── prompts/
│   └── article_prompt.md       # 默认 Prompt 模板（Task 8）
└── tests/
    ├── conftest.py
    ├── test_paths.py
    ├── test_config.py
    ├── test_shell.py
    ├── test_m2_download.py
    ├── test_m3_frames.py
    ├── test_m5_select.py
    ├── test_m6_grids.py
    ├── test_m7_article.py
    ├── test_m8_docx.py
    └── test_pipeline.py
```

---

### Task 1: 项目脚手架（git + uv + 依赖）

**Files:**
- Create: `.gitignore`, `pyproject.toml`（uv 生成后改）, `engine/__init__.py`, `tests/__init__.py`

- [ ] **Step 1: git init 并提交已有文档**

```bash
cd /Users/scream/diggo-press
git init
printf '.venv/\n__pycache__/\n*.pyc\n.pytest_cache/\nworkspace/\n.env\n' > .gitignore
git add .gitignore 视频生成文章-开发计划.md 视频生成文章-架构文档.md docs/
git commit -m "docs: 架构文档 + 开发计划 + P1 实现计划"
```

- [ ] **Step 2: 安装 uv 并初始化项目（Python 3.12）**

```bash
brew install uv
cd /Users/scream/diggo-press
uv init --bare --name diggo-press
uv python pin 3.12
uv add imagehash pillow python-docx httpx yt-dlp
uv add --dev pytest
```

- [ ] **Step 3: 创建包骨架并验证环境**

```bash
mkdir -p engine tests prompts
touch engine/__init__.py tests/__init__.py
uv run python -c "import imagehash, docx, httpx, PIL; print('deps ok')"
uv run yt-dlp --version
uv run pytest --version
```

Expected: 打印 `deps ok`、yt-dlp 版本号、pytest 版本号。

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml uv.lock .python-version engine/ tests/
git commit -m "chore: uv 项目脚手架 + 依赖"
```

---

### Task 2: paths.py — 目录与命名约定（最难回改，先定死）

**Files:**
- Create: `engine/paths.py`
- Test: `tests/test_paths.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_paths.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_paths.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'engine.paths'`

- [ ] **Step 3: Write the implementation**

```python
# engine/paths.py
"""目录结构与 HH_MM_SS 命名约定 — 全项目唯一定义处（架构文档第 7 节）。"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

_NAME_RE = re.compile(r"^(\d{2})_(\d{2})_(\d{2})$")


def seconds_to_name(seconds: int) -> str:
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}_{m:02d}_{s:02d}"


def name_to_seconds(name: str) -> int:
    m = _NAME_RE.match(name)
    if not m:
        raise ValueError(f"不是合法的 HH_MM_SS 名称: {name!r}")
    h, mi, s = (int(g) for g in m.groups())
    return h * 3600 + mi * 60 + s


def slugify_title(title: str, max_len: int = 50) -> str:
    slug = re.sub(r"[^\w一-鿿]+", "_", title, flags=re.UNICODE).strip("_")
    return slug[:max_len].rstrip("_")


@dataclass(frozen=True)
class TaskDir:
    root: Path

    @classmethod
    def create(cls, workroot: Path, video_id: str, title: str) -> "TaskDir":
        td = cls(Path(workroot) / f"{video_id}_{slugify_title(title)}")
        for d in (td.source, td.hd, td.webp, td.grids, td.article_dir, td.clips):
            d.mkdir(parents=True, exist_ok=True)
        return td

    @property
    def source(self) -> Path:
        return self.root / "source"

    @property
    def hd(self) -> Path:
        return self.root / "01_hd"

    @property
    def webp(self) -> Path:
        return self.root / "02_webp"

    @property
    def grids(self) -> Path:
        return self.root / "03_grids"

    @property
    def article_dir(self) -> Path:
        return self.root / "article"

    @property
    def clips(self) -> Path:
        return self.root / "mp4_clips"

    @property
    def task_json(self) -> Path:
        return self.root / "task.json"

    @property
    def representatives_json(self) -> Path:
        return self.root / "representatives.json"

    @property
    def article_json(self) -> Path:
        return self.article_dir / "article.json"

    @property
    def prompt_txt(self) -> Path:
        return self.article_dir / "prompt.txt"

    @property
    def docx(self) -> Path:
        return self.article_dir / "article_final.docx"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_paths.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add engine/paths.py tests/test_paths.py
git commit -m "feat: paths.py 目录结构与 HH_MM_SS 命名约定"
```

---

### Task 3: config.py + shell.py — 外部 CLI 绝对路径与调用封装

**Files:**
- Create: `engine/config.py`, `engine/shell.py`
- Test: `tests/test_config.py`, `tests/test_shell.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_config.py
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
```

```python
# tests/test_shell.py
import pytest

from engine.shell import run_cmd


def test_run_cmd_success():
    result = run_cmd(["/bin/echo", "hello"])
    assert result.returncode == 0
    assert "hello" in result.stdout


def test_run_cmd_failure_raises_with_stderr():
    with pytest.raises(RuntimeError, match="No such file"):
        run_cmd(["/bin/cat", "/nonexistent/file/xyz"])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_config.py tests/test_shell.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: Write the implementation**

```python
# engine/config.py
"""外部 CLI 工具的绝对路径。统一从这里取，禁止依赖 PATH（P4 打包后 Finder 启动只有精简 PATH）。

覆盖方式：环境变量 DIGGO_<TOOL大写>，如 DIGGO_FFMPEG=/path/to/ffmpeg
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# 本机实测路径（2026-06：ffmpeg-full 不软链进 /opt/homebrew/bin）
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
```

```python
# engine/shell.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_config.py tests/test_shell.py -v`
Expected: 5 passed

- [ ] **Step 5: 冒烟验证本机真实工具路径可用**

```bash
uv run python -c "
from engine.config import tool_path
from engine.shell import run_cmd
for t in ('ffmpeg', 'ffprobe', 'montage', 'yt-dlp'):
    print(t, '->', tool_path(t))
print(run_cmd([str(tool_path('ffmpeg')), '-version']).stdout.splitlines()[0])
"
```

Expected: 四个工具都解析出存在的绝对路径，并打印 ffmpeg 版本行。若 ffmpeg 路径不对，修正 `DEFAULT_TOOLS` 后重跑。

- [ ] **Step 6: Commit**

```bash
git add engine/config.py engine/shell.py tests/test_config.py tests/test_shell.py
git commit -m "feat: 外部 CLI 绝对路径配置与 subprocess 封装"
```

---

### Task 4: M2 下载（yt-dlp 封装）

**Files:**
- Create: `engine/m2_download.py`
- Test: `tests/test_m2_download.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_m2_download.py
from pathlib import Path

from engine.m2_download import build_download_args, build_info_args, find_outputs


def test_build_info_args():
    args = build_info_args("https://youtu.be/x")
    assert "--print" in args
    assert "--no-playlist" in args
    assert args[-1] == "https://youtu.be/x"


def test_build_download_args_default_1080():
    args = build_download_args("https://youtu.be/x", Path("/tmp/src"))
    joined = " ".join(args)
    assert "bv*[height<=1080]+ba/b[height<=1080]" in joined
    assert "--merge-output-format mp4" in joined
    assert "--write-subs" in joined and "--write-auto-subs" in joined
    assert "--sub-langs" in joined and "en" in joined
    assert "--convert-subs srt" in joined
    assert "--cookies-from-browser" not in joined


def test_build_download_args_1440_with_cookies():
    args = build_download_args(
        "https://youtu.be/x", Path("/tmp/src"), quality=1440, browser="chrome"
    )
    joined = " ".join(args)
    assert "height<=1440" in joined
    assert "--cookies-from-browser chrome" in joined


def test_find_outputs(tmp_path: Path):
    (tmp_path / "video [abc].mp4").write_bytes(b"x")
    (tmp_path / "video [abc].en.srt").write_text("1\n00:00:00,000 --> 00:00:01,000\nhi\n")
    mp4, srt = find_outputs(tmp_path)
    assert mp4.suffix == ".mp4"
    assert srt is not None and srt.suffix == ".srt"


def test_find_outputs_no_srt(tmp_path: Path):
    (tmp_path / "video [abc].mp4").write_bytes(b"x")
    mp4, srt = find_outputs(tmp_path)
    assert srt is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_m2_download.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: Write the implementation**

```python
# engine/m2_download.py
"""M2 下载：yt-dlp 封装。默认 1080p（<= 防无对应分辨率失败）、英文人工+自动字幕转 srt。"""
from __future__ import annotations

from pathlib import Path

from engine.config import tool_path
from engine.shell import run_cmd


def build_info_args(url: str) -> list[str]:
    return [
        str(tool_path("yt-dlp")),
        "--no-playlist",
        "--print", "%(id)s\t%(title)s",
        "--skip-download",
        url,
    ]


def fetch_video_info(url: str) -> tuple[str, str]:
    """返回 (video_id, title)，下载前先取，用于创建任务目录。"""
    result = run_cmd(build_info_args(url), timeout=120)
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
        "--sub-langs", "en.*,en",
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
    srts = sorted(source_dir.glob("*.srt"))
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_m2_download.py -v`
Expected: 5 passed

- [ ] **Step 5: 真实 URL 冒烟（短视频，人工验证一次）**

```bash
mkdir -p /tmp/m2_smoke
uv run python -c "
from pathlib import Path
from engine.m2_download import fetch_video_info, download
url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'  # 'Me at the zoo', 19 秒
print(fetch_video_info(url))
print(download(url, Path('/tmp/m2_smoke')))
"
ls -la /tmp/m2_smoke/
```

Expected: 打印 `('jNQXAC9IVRw', 'Me at the zoo')`，目录里有 mp4（该片可能无英文 srt，srt 为 None 属正常）。若被风控拦截，报错信息应清晰可读。

- [ ] **Step 6: Commit**

```bash
git add engine/m2_download.py tests/test_m2_download.py
git commit -m "feat: M2 yt-dlp 下载封装"
```

---

### Task 5: M3 帧生成（一趟 ffmpeg：抽帧+缩放+水印+webp）— 兼 S2 验证

**Files:**
- Create: `engine/m3_frames.py`
- Test: `tests/test_m3_frames.py`, `tests/conftest.py`

**要点：** ffmpeg 的 `-frame_pts 1` 让输出文件名直接等于帧的 pts 秒数（fps=1 时即 0,1,2…），Python 端把 `N.webp` 重命名为 `HH_MM_SS.webp` 是纯算术 rename，不是拷贝。水印用 drawtext 的 `%{pts\:hms}` 展开（输出形如 `00:01:15.000`，fps=1 下毫秒恒为 .000，可接受且转义最简单——这是 S2 的关键不确定点，集成测试直接验证）。HD 全集输出 **jpg**（python-docx 不支持嵌 webp）。

- [ ] **Step 1: Write conftest fixture（生成 5 秒测试视频）**

```python
# tests/conftest.py
from pathlib import Path

import pytest

from engine.config import tool_path
from engine.shell import run_cmd


@pytest.fixture(scope="session")
def sample_video(tmp_path_factory) -> Path:
    """5 秒 1280x720 测试视频（testsrc 画面带帧计数，便于肉眼核对）。"""
    out = tmp_path_factory.mktemp("video") / "sample.mp4"
    run_cmd([
        str(tool_path("ffmpeg")), "-y",
        "-f", "lavfi", "-i", "testsrc=duration=5:size=1280x720:rate=30",
        "-pix_fmt", "yuv420p",
        str(out),
    ])
    return out
```

- [ ] **Step 2: Write the failing tests**

```python
# tests/test_m3_frames.py
from pathlib import Path

from engine.m3_frames import build_hd_args, build_webp_args, generate_frames


def test_build_webp_args_contains_pipeline_pieces(tmp_path: Path):
    args = build_webp_args(Path("/v.mp4"), tmp_path)
    joined = " ".join(args)
    assert "fps=1" in joined
    assert "scale=640:360" in joined
    assert "drawtext" in joined
    assert "-frame_pts" in args
    assert joined.endswith("%d.webp")


def test_build_hd_args(tmp_path: Path):
    args = build_hd_args(Path("/v.mp4"), tmp_path)
    joined = " ".join(args)
    assert "fps=1" in joined and "scale=1280:720" in joined
    assert "drawtext" not in joined
    assert joined.endswith("%d.jpg")


def test_generate_frames_integration(sample_video: Path, tmp_path: Path):
    webp_dir = tmp_path / "02_webp"
    hd_dir = tmp_path / "01_hd"
    webp_dir.mkdir()
    hd_dir.mkdir()

    count = generate_frames(sample_video, webp_dir=webp_dir, hd_dir=hd_dir)

    webp_names = sorted(p.name for p in webp_dir.glob("*.webp"))
    hd_names = sorted(p.name for p in hd_dir.glob("*.jpg"))
    # 5 秒视频 fps=1 → 第 0..4 秒，共 5 帧（允许 ±1 帧封装误差）
    assert count == len(webp_names)
    assert 4 <= len(webp_names) <= 6
    assert webp_names[0] == "00_00_00.webp"
    assert "00_00_04.webp" in webp_names
    # 两个全集帧名一一对应（S2: 时间戳与文件名对齐）
    assert [n.removesuffix(".webp") for n in webp_names] == [
        n.removesuffix(".jpg") for n in hd_names
    ]


def test_generate_frames_idempotent(sample_video: Path, tmp_path: Path):
    webp_dir = tmp_path / "w"
    hd_dir = tmp_path / "h"
    webp_dir.mkdir()
    hd_dir.mkdir()
    c1 = generate_frames(sample_video, webp_dir=webp_dir, hd_dir=hd_dir)
    c2 = generate_frames(sample_video, webp_dir=webp_dir, hd_dir=hd_dir)
    assert c1 == c2
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_m3_frames.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 4: Write the implementation**

```python
# engine/m3_frames.py
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_m3_frames.py -v`
Expected: 4 passed。若 drawtext 转义报错（`%{pts\:hms}` 在不同 ffmpeg 版本转义略有差异），调整反斜杠层数直到集成测试通过——这正是 S2 要定型的命令。

- [ ] **Step 6: 人工核对水印（S2 验收）**

```bash
uv run python -c "
import tempfile
from pathlib import Path
from engine.config import tool_path
from engine.shell import run_cmd
from engine.m3_frames import generate_frames
d = Path(tempfile.mkdtemp())
v = d / 'v.mp4'
run_cmd([str(tool_path('ffmpeg')), '-y', '-f', 'lavfi', '-i',
         'testsrc=duration=130:size=1280x720:rate=30', '-pix_fmt', 'yuv420p', str(v)])
w = d / 'w'; h = d / 'h'; w.mkdir(); h.mkdir()
generate_frames(v, w, h)
print('open', w)
"
```

然后 `open` 该目录，肉眼核对：`00_02_05.webp` 左上角水印应显示 `00:02:05.000`，黑底白字清晰可读。核对 2-3 张不同时间点的帧。

- [ ] **Step 7: Commit**

```bash
git add engine/m3_frames.py tests/test_m3_frames.py tests/conftest.py
git commit -m "feat: M3 一趟 ffmpeg 帧生成（水印 webp 全集 + HD jpg 全集）"
```

---

### Task 6: M5 去重选帧（phash 代表帧清单）

**Files:**
- Create: `engine/m5_select.py`
- Test: `tests/test_m5_select.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_m5_select.py
import json
from pathlib import Path

from PIL import Image, ImageDraw

from engine.m5_select import select_representatives, write_manifest


def _make_frame(path: Path, kind: str) -> None:
    img = Image.new("RGB", (640, 360), "white")
    draw = ImageDraw.Draw(img)
    if kind == "checker":
        for x in range(0, 640, 40):
            for y in range(0, 360, 40):
                if (x // 40 + y // 40) % 2 == 0:
                    draw.rectangle([x, y, x + 40, y + 40], fill="black")
    elif kind == "stripes":
        for x in range(0, 640, 20):
            draw.rectangle([x, 0, x + 10, 360], fill="black")
    img.save(path, "WEBP")


def test_select_keeps_first_and_distinct(tmp_path: Path):
    # 3 张白色 → 1 张棋盘 → 2 张竖纹：应选出 3 张代表帧
    kinds = ["white", "white", "white", "checker", "stripes", "stripes"]
    for i, kind in enumerate(kinds):
        _make_frame(tmp_path / f"00_00_0{i}.webp", kind)
    kept = select_representatives(tmp_path, threshold=10)
    assert kept[0] == "00_00_00"
    assert "00_00_03" in kept
    assert "00_00_04" in kept
    assert len(kept) == 3


def test_threshold_zero_keeps_all(tmp_path: Path):
    for i in range(3):
        _make_frame(tmp_path / f"00_00_0{i}.webp", "white")
    assert len(select_representatives(tmp_path, threshold=0)) == 3


def test_write_manifest(tmp_path: Path):
    out = tmp_path / "representatives.json"
    write_manifest(out, ["00_00_00", "00_00_03"], threshold=15)
    data = json.loads(out.read_text())
    assert data["threshold"] == 15
    assert data["frames"] == ["00_00_00", "00_00_03"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_m5_select.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: Write the implementation**

```python
# engine/m5_select.py
"""M5 去重选帧：phash 在 640 webp 全集上挑代表帧清单（仅服务于喂 Gemini）。

逐秒全集不动；与上一张**已保留**的代表帧距离 >= threshold 才保留。
"""
from __future__ import annotations

import json
from pathlib import Path

import imagehash
from PIL import Image


def select_representatives(webp_dir: Path, threshold: int = 15) -> list[str]:
    """返回保留帧的名字列表（无扩展名，HH_MM_SS，按时间序）。"""
    names = sorted(p.stem for p in webp_dir.glob("*.webp"))
    kept: list[str] = []
    last_hash = None
    for name in names:
        with Image.open(webp_dir / f"{name}.webp") as img:
            h = imagehash.phash(img)
        # threshold=0 时任何距离都 >= 0，等价于保留全部
        if last_hash is None or (h - last_hash) >= threshold:
            kept.append(name)
            last_hash = h
    return kept


def write_manifest(path: Path, frames: list[str], threshold: int) -> None:
    path.write_text(
        json.dumps({"threshold": threshold, "frames": frames}, indent=2),
        encoding="utf-8",
    )


def load_manifest(path: Path) -> list[str]:
    return json.loads(path.read_text(encoding="utf-8"))["frames"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_m5_select.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add engine/m5_select.py tests/test_m5_select.py
git commit -m "feat: M5 phash 去重选代表帧"
```

---

### Task 7: M6 宫格图（montage 10×5）

**Files:**
- Create: `engine/m6_grids.py`
- Test: `tests/test_m6_grids.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_m6_grids.py
from pathlib import Path

from PIL import Image

from engine.m6_grids import build_grids


def _make_frames(d: Path, n: int) -> list[str]:
    names = []
    for i in range(n):
        name = f"00_00_{i:02d}" if i < 60 else f"00_01_{i - 60:02d}"
        Image.new("RGB", (640, 360), (i * 2 % 255, 100, 150)).save(
            d / f"{name}.webp", "WEBP"
        )
        names.append(name)
    return names


def test_build_grids_chunks_of_50(tmp_path: Path):
    webp = tmp_path / "02_webp"
    grids = tmp_path / "03_grids"
    webp.mkdir()
    grids.mkdir()
    names = _make_frames(webp, 60)  # 60 张 → 2 组宫格

    outputs = build_grids(webp_dir=webp, grids_dir=grids, frames=names)

    assert [p.name for p in outputs] == ["grid_001.jpg", "grid_002.jpg"]
    assert all(p.is_file() and p.stat().st_size > 0 for p in outputs)
    with Image.open(outputs[0]) as img:  # 10 列 × 5 行，单元 320x180 + 间隙
        assert img.width > 3000 and img.height > 800


def test_build_grids_idempotent(tmp_path: Path):
    webp = tmp_path / "w"
    grids = tmp_path / "g"
    webp.mkdir()
    grids.mkdir()
    names = _make_frames(webp, 5)
    out1 = build_grids(webp, grids, names)
    out2 = build_grids(webp, grids, names)
    assert out1 == out2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_m6_grids.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: Write the implementation**

```python
# engine/m6_grids.py
"""M6 宫格图：montage 把代表帧拼成 10×5=50 张/组（每格 320x180，水印随帧自带）。"""
from __future__ import annotations

from pathlib import Path

from engine.config import tool_path
from engine.shell import run_cmd

PER_GRID = 50
TILE = "10x5"
CELL = "320x180"


def build_grids(webp_dir: Path, grids_dir: Path, frames: list[str]) -> list[Path]:
    """frames 为 HH_MM_SS 名列表（来自 M5 manifest）。幂等：已有同名产物则跳过。"""
    outputs: list[Path] = []
    for i in range(0, len(frames), PER_GRID):
        chunk = frames[i : i + PER_GRID]
        out = grids_dir / f"grid_{i // PER_GRID + 1:03d}.jpg"
        outputs.append(out)
        if out.is_file():
            continue
        args = (
            [str(tool_path("montage"))]
            + [str(webp_dir / f"{n}.webp") for n in chunk]
            + ["-tile", TILE, "-geometry", f"{CELL}+2+2", "-background", "black", str(out)]
        )
        run_cmd(args, timeout=600)
    return outputs
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_m6_grids.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add engine/m6_grids.py tests/test_m6_grids.py
git commit -m "feat: M6 montage 宫格图"
```

---

### Task 8: M7 文章生成 — JSON 契约校验 + Prompt 模板 + 半自动模式

**Files:**
- Create: `engine/m7_article.py`, `prompts/article_prompt.md`
- Test: `tests/test_m7_article.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_m7_article.py
import json
from pathlib import Path

import pytest

from engine.m7_article import parse_article_text, prepare_materials, validate_article

GOOD = {
    "pages": [
        {"subhead": "Intro", "image": "00_00_05", "body": "Some text."},
        {"subhead": "Main", "image": "00_01_15", "body": "More.", "notes_zh": "说明"},
    ],
    "meta": {
        "titles": ["Title A", "Title B"],
        "keywords": ["k1", "k2"],
        "description": "Desc.",
    },
}


def test_validate_good():
    assert validate_article(GOOD) == []


def test_validate_catches_errors():
    bad = {
        "pages": [{"subhead": "x", "image": "0:00:05", "body": ""}],
        "meta": {"titles": [], "keywords": "k", "description": ""},
    }
    errors = validate_article(bad)
    assert any("image" in e for e in errors)      # 非 HH_MM_SS
    assert any("titles" in e for e in errors)     # 空列表
    assert any("keywords" in e for e in errors)   # 不是列表


def test_validate_missing_pages():
    assert any("pages" in e for e in validate_article({"meta": GOOD["meta"]}))


def test_parse_article_text_strips_fences():
    text = "```json\n" + json.dumps(GOOD) + "\n```"
    assert parse_article_text(text)["pages"][0]["image"] == "00_00_05"


def test_parse_article_text_plain():
    assert parse_article_text(json.dumps(GOOD))["meta"]["description"] == "Desc."


def test_parse_article_text_invalid_raises():
    with pytest.raises(ValueError, match="JSON"):
        parse_article_text("not json at all")


def test_prepare_materials(tmp_path: Path):
    template = tmp_path / "tpl.md"
    template.write_text("PROMPT HEAD\n{{SUBTITLES}}\nTAIL", encoding="utf-8")
    srt = tmp_path / "v.en.srt"
    srt.write_text("1\n00:00:00,000 --> 00:00:01,000\nhello world\n", encoding="utf-8")
    out = tmp_path / "prompt.txt"

    prepare_materials(template, srt, out)

    text = out.read_text(encoding="utf-8")
    assert "PROMPT HEAD" in text and "hello world" in text and "{{SUBTITLES}}" not in text


def test_prepare_materials_no_srt(tmp_path: Path):
    template = tmp_path / "tpl.md"
    template.write_text("HEAD\n{{SUBTITLES}}", encoding="utf-8")
    out = tmp_path / "prompt.txt"
    prepare_materials(template, None, out)
    assert "无字幕" in out.read_text(encoding="utf-8")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_m7_article.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: Write the implementation**

```python
# engine/m7_article.py
"""M7 文章生成：JSON 契约校验、容错解析、半自动素材准备、Gemini API 自动模式。

JSON 契约（架构文档 5.4，全项目唯一权威定义）：
{
  "pages": [{"subhead": str, "image": "HH_MM_SS", "body": str, "notes_zh"?: str}],
  "meta": {"titles": [str], "keywords": [str], "description": str},
  "analysis_zh"?: str
}
"""
from __future__ import annotations

import json
import re
from pathlib import Path

_IMAGE_RE = re.compile(r"^\d{2}_\d{2}_\d{2}$")


def validate_article(data: dict) -> list[str]:
    """返回错误列表；空列表 = 合法。"""
    errors: list[str] = []
    pages = data.get("pages")
    if not isinstance(pages, list) or not pages:
        errors.append("pages 必须是非空列表")
    else:
        for i, page in enumerate(pages):
            for key in ("subhead", "body"):
                if not isinstance(page.get(key), str) or not page.get(key):
                    errors.append(f"pages[{i}].{key} 必须是非空字符串")
            img = page.get("image", "")
            if not isinstance(img, str) or not _IMAGE_RE.match(img):
                errors.append(f"pages[{i}].image 必须是 HH_MM_SS 格式，got {img!r}")
    meta = data.get("meta")
    if not isinstance(meta, dict):
        errors.append("缺少 meta 对象")
    else:
        for key in ("titles", "keywords"):
            v = meta.get(key)
            if not isinstance(v, list) or not v:
                errors.append(f"meta.{key} 必须是非空列表")
        if not isinstance(meta.get("description"), str) or not meta.get("description"):
            errors.append("meta.description 必须是非空字符串")
    return errors


def parse_article_text(text: str) -> dict:
    """容错解析：剥 ```json 围栏、截取首尾花括号之间内容，再校验契约。"""
    stripped = text.strip()
    stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
    stripped = re.sub(r"\s*```$", "", stripped)
    start, end = stripped.find("{"), stripped.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"文本中找不到 JSON 对象:\n{text[:200]}")
    try:
        data = json.loads(stripped[start : end + 1])
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 解析失败: {e}") from e
    errors = validate_article(data)
    if errors:
        raise ValueError("JSON 不符合契约:\n" + "\n".join(errors))
    return data


def prepare_materials(template: Path, srt: Path | None, out: Path) -> None:
    """半自动模式：把 Prompt 模板 + 字幕拼成 article/prompt.txt 供人工粘贴。"""
    subtitles = (
        srt.read_text(encoding="utf-8", errors="replace") if srt else "（本视频无字幕）"
    )
    out.write_text(
        template.read_text(encoding="utf-8").replace("{{SUBTITLES}}", subtitles),
        encoding="utf-8",
    )
```

- [ ] **Step 4: 创建默认 Prompt 模板**

```markdown
<!-- prompts/article_prompt.md -->
You are an expert tech writer. I will give you: (1) grid images of video
frames — each frame has its timestamp watermarked in the top-left corner as
HH:MM:SS, and (2) the video's English subtitles below.

Write an illustrated article based on the video. Choose the most relevant
frame for each section by reading the watermark timestamps.

Output STRICT JSON only — no markdown fences, no commentary outside JSON —
exactly matching this schema:

{
  "pages": [
    {
      "subhead": "Section heading",
      "image": "HH_MM_SS",
      "body": "Section body text (1-3 paragraphs, separate with \n\n)",
      "notes_zh": "（可选）为什么选这帧配图，用中文，不会进入正文"
    }
  ],
  "meta": {
    "titles": ["3-5 candidate article titles"],
    "keywords": ["5-10 SEO keywords"],
    "description": "One-paragraph SEO description"
  },
  "analysis_zh": "（可选）文章框架的中文说明，不会进入正文"
}

Rules:
- "image" must be the watermark timestamp with colons replaced by
  underscores, e.g. watermark 00:01:15 → "00_01_15".
- 8-15 pages for a typical 10-40 minute video.
- Body text in English; notes_zh / analysis_zh in Chinese.

Subtitles:

{{SUBTITLES}}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_m7_article.py -v`
Expected: 8 passed

- [ ] **Step 6: Commit**

```bash
git add engine/m7_article.py prompts/article_prompt.md tests/test_m7_article.py
git commit -m "feat: M7 JSON 契约校验 + 半自动素材准备 + Prompt 模板"
```

---

### Task 9: M7 自动模式（Gemini API）

**Files:**
- Modify: `engine/m7_article.py`（追加到文件末尾）
- Test: `tests/test_m7_article.py`（追加）

- [ ] **Step 1: Write the failing tests（追加到 tests/test_m7_article.py）**

```python
# 追加到 tests/test_m7_article.py
import base64

import httpx

from engine.m7_article import build_gemini_payload, call_gemini


def test_build_gemini_payload(tmp_path: Path):
    img = tmp_path / "grid_001.jpg"
    img.write_bytes(b"\xff\xd8fakejpeg")
    payload = build_gemini_payload("the prompt", [img])
    parts = payload["contents"][0]["parts"]
    assert parts[0] == {"text": "the prompt"}
    assert parts[1]["inline_data"]["mime_type"] == "image/jpeg"
    assert base64.b64decode(parts[1]["inline_data"]["data"]) == b"\xff\xd8fakejpeg"
    assert payload["generationConfig"]["response_mime_type"] == "application/json"


def test_call_gemini_parses_response(tmp_path: Path, monkeypatch):
    body = {
        "candidates": [
            {"content": {"parts": [{"text": json.dumps(GOOD)}]}}
        ]
    }

    def fake_post(url, json=None, timeout=None):
        assert "models/gemini-test:generateContent" in url
        return httpx.Response(200, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    data = call_gemini("prompt", [], api_key="k", model="gemini-test")
    assert data["pages"][0]["image"] == "00_00_05"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_m7_article.py -v`
Expected: 新增 2 个 FAIL — ImportError（build_gemini_payload 不存在）

- [ ] **Step 3: Write the implementation（追加到 engine/m7_article.py）**

```python
# 追加到 engine/m7_article.py
import base64

import httpx

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def build_gemini_payload(prompt_text: str, image_paths: list[Path]) -> dict:
    parts: list[dict] = [{"text": prompt_text}]
    for p in image_paths:
        parts.append({
            "inline_data": {
                "mime_type": "image/jpeg",
                "data": base64.b64encode(p.read_bytes()).decode("ascii"),
            }
        })
    return {
        "contents": [{"parts": parts}],
        "generationConfig": {"response_mime_type": "application/json"},
    }


def call_gemini(
    prompt_text: str,
    image_paths: list[Path],
    api_key: str,
    model: str = "gemini-2.5-pro",
) -> dict:
    """自动模式：调 Gemini API，返回已通过契约校验的 article dict。"""
    url = GEMINI_URL.format(model=model) + f"?key={api_key}"
    resp = httpx.post(url, json=build_gemini_payload(prompt_text, image_paths), timeout=600)
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini API {resp.status_code}: {resp.text[:500]}")
    text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
    return parse_article_text(text)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_m7_article.py -v`
Expected: 10 passed

- [ ] **Step 5: Commit**

```bash
git add engine/m7_article.py tests/test_m7_article.py
git commit -m "feat: M7 Gemini API 自动模式"
```

---

### Task 10: M8 文档组装（python-docx 程序化一次性生成）

**Files:**
- Create: `engine/m8_docx.py`
- Test: `tests/test_m8_docx.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_m8_docx.py
from pathlib import Path

from docx import Document
from PIL import Image

from engine.m8_docx import build_docx

ARTICLE = {
    "pages": [
        {"subhead": "Intro", "image": "00_00_01", "body": "Para one.\n\nPara two."},
        {"subhead": "Missing pic", "image": "09_59_59", "body": "Body.",
         "notes_zh": "中文说明不应出现在 docx 里"},
    ],
    "meta": {
        "titles": ["Best Title", "Alt Title"],
        "keywords": ["k1", "k2"],
        "description": "The description.",
    },
}


def _make_hd(d: Path, name: str) -> None:
    Image.new("RGB", (1280, 720), "blue").save(d / f"{name}.jpg", "JPEG")


def test_build_docx(tmp_path: Path):
    hd = tmp_path / "01_hd"
    hd.mkdir()
    _make_hd(hd, "00_00_01")
    out = tmp_path / "article_final.docx"

    warnings = build_docx(ARTICLE, hd_dir=hd, out_path=out)

    assert out.is_file()
    assert any("09_59_59" in w for w in warnings)  # 缺图给警告而非崩溃

    doc = Document(str(out))
    texts = [p.text for p in doc.paragraphs]
    headings = [p.text for p in doc.paragraphs if p.style.name.startswith("Heading")]
    assert "Intro" in headings and "Missing pic" in headings
    assert "Para one." in texts and "Para two." in texts
    assert any("Best Title" in t for t in texts)        # 文末 meta
    assert any("k1, k2" in t for t in texts)
    assert any("The description." in t for t in texts)
    assert not any("中文说明" in t for t in texts)       # notes_zh 不进正文
    assert len(doc.inline_shapes) == 1                   # 只有存在的那张图


def test_build_docx_image_centered(tmp_path: Path):
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    hd = tmp_path / "hd"
    hd.mkdir()
    _make_hd(hd, "00_00_01")
    out = tmp_path / "a.docx"
    build_docx(
        {"pages": [ARTICLE["pages"][0]], "meta": ARTICLE["meta"]}, hd, out
    )
    doc = Document(str(out))
    pic_paras = [
        p for p in doc.paragraphs
        if p._p.xpath(".//*[local-name()='drawing']")
    ]
    assert pic_paras and pic_paras[0].alignment == WD_ALIGN_PARAGRAPH.CENTER
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_m8_docx.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: Write the implementation**

```python
# engine/m8_docx.py
"""M8 文档组装：读 M7 JSON，python-docx 一次性生成 article_final.docx。

每页：Heading 2 小标题 → HD 配图（6 英寸宽等比居中）→ 正文段落。
文末：meta（候选标题 / 关键词 / 描述）。notes_zh / analysis_zh 不进正文。
缺图：记 warning 跳过，不中断。
"""
from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches


def build_docx(article: dict, hd_dir: Path, out_path: Path) -> list[str]:
    warnings: list[str] = []
    doc = Document()

    for page in article["pages"]:
        doc.add_heading(page["subhead"], level=2)
        img = hd_dir / f"{page['image']}.jpg"
        if img.is_file():
            para = doc.add_paragraph()
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            para.add_run().add_picture(str(img), width=Inches(6))
        else:
            warnings.append(f"配图缺失，已跳过: {page['image']} (页 {page['subhead']!r})")
        for chunk in page["body"].split("\n\n"):
            if chunk.strip():
                doc.add_paragraph(chunk.strip())

    meta = article["meta"]
    doc.add_heading("Meta", level=2)
    doc.add_paragraph("Titles: " + " | ".join(meta["titles"]))
    doc.add_paragraph("Keywords: " + ", ".join(meta["keywords"]))
    doc.add_paragraph("Description: " + meta["description"])

    doc.save(str(out_path))
    return warnings
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_m8_docx.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add engine/m8_docx.py tests/test_m8_docx.py
git commit -m "feat: M8 python-docx 程序化生成 docx"
```

---

### Task 11: pipeline + run.py（串联 + from-step 重跑）

**Files:**
- Create: `engine/pipeline.py`, `run.py`
- Test: `tests/test_pipeline.py`

**步骤名（固定契约）：** `download → frames → select → grids → article → docx`。
半自动模式在 `grids` 后生成 `prompt.txt` 并停下，提示用户把 Gemini 返回的 JSON 存到 `article/article.json`，再 `python run.py --task-dir <dir> --from docx` 续跑。

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_pipeline.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_pipeline.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: Write pipeline.py**

```python
# engine/pipeline.py
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
```

- [ ] **Step 4: Write run.py**

```python
# run.py
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
    parser.add_argument("--browser", choices=["safari", "chrome"])
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
        video_id, title = fetch_video_info(args.url)
        td = TaskDir.create(Path(args.workroot).resolve(), video_id, title)
        url = args.url
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_pipeline.py -v`
Expected: 5 passed

- [ ] **Step 6: 全量回归**

Run: `uv run pytest -v`
Expected: 全部通过（约 30 个用例）

- [ ] **Step 7: Commit**

```bash
git add engine/pipeline.py run.py tests/test_pipeline.py
git commit -m "feat: pipeline 串联 + run.py CLI（from-step 重跑）"
```

---

### Task 12: 端到端验收（真实 YouTube URL，人工参与）

**P1 验收标准（开发计划 3.3）：** 给一条真实 YouTube URL，命令行能产出可用的 `article_final.docx`，配图正确、正文与 meta 完整。

- [ ] **Step 1: 跑预处理段（download → grids）**

```bash
cd /Users/scream/diggo-press
uv run python run.py 'https://www.youtube.com/watch?v=<选一条 10-20 分钟的真实视频>' --to grids
```

Expected: workspace 下出现任务目录；`01_hd/`、`02_webp/` 帧数 ≈ 视频秒数；`representatives.json` 帧数明显少于全集；`03_grids/` 有若干 grid_NNN.jpg。
检查点：打开一张宫格图，确认每格水印时间戳清晰可读（S2 最终验收）；若代表帧太少/太多，用 `--threshold` 调整后 `--from select` 重跑（开发计划第 8 节：阈值用真实素材校准）。

- [ ] **Step 2: 半自动模式走完 M7**

把 `article/prompt.txt` + `03_grids/` 的图贴给 Gemini 网页版，把返回 JSON 存为 `article/article.json`，然后：

```bash
uv run python run.py --task-dir 'workspace/<任务目录>' --from article
```

Expected: JSON 校验通过（不合法会列出具体字段错误——这是 S1 的失败样本收集点），生成 `article/article_final.docx`。

- [ ] **Step 3: （如已有 GEMINI_API_KEY）自动模式全程**

```bash
rm -rf 'workspace/<任务目录>/article'
GEMINI_API_KEY=<key> uv run python run.py --task-dir 'workspace/<任务目录>' --from article --mode auto
```

Expected: 不经人工，直接产出 docx。

- [ ] **Step 4: 人工验收 docx**

打开 `article_final.docx` 核对：每节有小标题 + 居中配图 + 正文；配图与正文内容相关（时间戳对应）；文末有 Titles/Keywords/Description；无中文说明混入正文。

- [ ] **Step 5: 记录验收结论并提交**

把阈值实测值、Gemini JSON 失败样本（如有）记进 `docs/superpowers/plans/2026-06-11-p1-acceptance-notes.md`，然后：

```bash
git add docs/
git commit -m "docs: P1 端到端验收记录"
```

---

## 范围说明（本计划不做）

- **M10 视频切片**：开发计划标注「可选、低优先」，YAGNI，P1 验收不依赖，留待需要时单独加。
- **M9 飞书上传**：P1 只要求本地 docx 落盘（已由 M8 覆盖），飞书留待评估。
- **字幕清洗（优化⑤）**：Task 12 验收时若发现 token 占用/质量问题再立项。
- **S3 打包签名 spike**：与本计划并行推进，不在此文档内。
