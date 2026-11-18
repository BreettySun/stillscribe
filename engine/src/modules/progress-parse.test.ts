import { describe, it, expect, beforeAll } from "vitest";

// arg-builder 解析这些纯函数不依赖工具路径，但 m3 顶部 import toolPath 间接需要；保持与 args.test 同款桩。
beforeAll(() => {
  process.env.STILLSCRIBE_YT_DLP = process.execPath;
  process.env.STILLSCRIBE_FFMPEG = process.execPath;
  process.env.STILLSCRIBE_FFPROBE = process.execPath;
});

const { parseDownloadRatio, buildDownloadArgs } = await import("./m2-download.ts");
const { parseFfmpegOutTimeSeconds, buildWebpArgs, buildHdArgs } = await import("./m3-frames.ts");

describe("parseDownloadRatio（yt-dlp 百分比）", () => {
  it("解析 [download] xx.x%", () => {
    expect(parseDownloadRatio("[download]  12.3% of 100MiB at 1MiB/s")).toBeCloseTo(0.123);
  });
  it("一段多行取最后一条", () => {
    const chunk = "[download]   1.0% of x\n[download]  50.0% of x\n[download]  99.9% of x\n";
    expect(parseDownloadRatio(chunk)).toBeCloseTo(0.999);
  });
  it("无进度行返回 null", () => {
    expect(parseDownloadRatio("[info] something else")).toBeNull();
  });
  it("buildDownloadArgs 带 --newline（逐行进度）", () => {
    expect(buildDownloadArgs("URL", "/t/source")).toContain("--newline");
  });
});

describe("parseFfmpegOutTimeSeconds（ffmpeg -progress）", () => {
  it("out_time=HH:MM:SS.ms → 秒", () => {
    expect(parseFfmpegOutTimeSeconds("out_time=00:01:23.000000\nprogress=continue")).toBeCloseTo(83);
  });
  it("多条取最后一条", () => {
    const chunk = "out_time=00:00:10.000000\nout_time=00:00:20.500000\n";
    expect(parseFfmpegOutTimeSeconds(chunk)).toBeCloseTo(20.5);
  });
  it("无匹配返回 null", () => {
    expect(parseFfmpegOutTimeSeconds("frame=10\nfps=0")).toBeNull();
  });
  it("ffmpeg 命令带 -progress pipe:1，且输出路径仍在末位", () => {
    const w = buildWebpArgs("/v.mp4", "/t/02_webp");
    expect(w).toEqual(expect.arrayContaining(["-progress", "pipe:1"]));
    expect(w.at(-1)).toBe("/t/02_webp/%d.webp");
    const h = buildHdArgs("/v.mp4", "/t/01_hd");
    expect(h).toEqual(expect.arrayContaining(["-progress", "pipe:1"]));
    expect(h.at(-1)).toBe("/t/01_hd/%d.jpg");
  });
});
