from pathlib import Path

from engine.m2_download import build_download_args, build_info_args, find_outputs


def test_build_info_args():
    args = build_info_args("https://youtu.be/x")
    assert "--print" in args
    assert "--no-playlist" in args
    assert args[-1] == "https://youtu.be/x"
    assert "--cookies-from-browser" not in args


def test_build_info_args_with_browser():
    args = build_info_args("https://youtu.be/x", browser="chrome")
    assert "--cookies-from-browser chrome" in " ".join(args)


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


def test_find_outputs_prefers_plain_en_srt(tmp_path: Path):
    (tmp_path / "v [abc].mp4").write_bytes(b"x")
    (tmp_path / "v [abc].en-de.srt").write_text("translated")
    (tmp_path / "v [abc].en.srt").write_text("original")
    _mp4, srt = find_outputs(tmp_path)
    assert srt is not None and srt.name.endswith(".en.srt")


def test_find_outputs_no_srt(tmp_path: Path):
    (tmp_path / "video [abc].mp4").write_bytes(b"x")
    mp4, srt = find_outputs(tmp_path)
    assert srt is None
