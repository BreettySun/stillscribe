import { describe, it, expect, beforeAll } from "vitest";

// toolPath 会校验文件存在；测试与机器解耦，用 node 自身可执行文件冒充工具路径。
// 只断言生成的命令“参数形状”，不实际调用工具。
beforeAll(() => {
  process.env.DIGGO_YT_DLP = process.execPath;
  process.env.DIGGO_FFMPEG = process.execPath;
});

const { buildInfoArgs, buildDownloadArgs } = await import("./m2-download.ts");
const { buildWebpArgs, buildHdArgs } = await import("./m3-frames.ts");

describe("M2 yt-dlp arg-builders（与已验证命令逐字对齐）", () => {
  it("buildInfoArgs", () => {
    expect(buildInfoArgs("URL")).toEqual([
      process.execPath,
      "--no-playlist",
      "--print", "%(id)s\t%(title)s",
      "--skip-download",
      "URL",
    ]);
  });

  it("buildInfoArgs 带 cookie", () => {
    const a = buildInfoArgs("URL", "safari");
    expect(a).toContain("--cookies-from-browser");
    expect(a[a.indexOf("--cookies-from-browser") + 1]).toBe("safari");
    expect(a.at(-1)).toBe("URL");
  });

  it("buildDownloadArgs 画质/字幕/输出模板", () => {
    const a = buildDownloadArgs("URL", "/t/source", 1080);
    expect(a).toContain("-f");
    expect(a[a.indexOf("-f") + 1]).toBe("bv*[height<=1080]+ba/b[height<=1080]");
    expect(a).toEqual(expect.arrayContaining([
      "--merge-output-format", "mp4",
      "--write-subs", "--write-auto-subs",
      "--sub-langs", "en.*,en",
      "--convert-subs", "srt",
    ]));
    expect(a[a.indexOf("-o") + 1]).toBe("/t/source/%(title).80s [%(id)s].%(ext)s");
    expect(a.at(-1)).toBe("URL");
  });

  it("buildDownloadArgs 1440p", () => {
    const a = buildDownloadArgs("URL", "/t/source", 1440);
    expect(a[a.indexOf("-f") + 1]).toBe("bv*[height<=1440]+ba/b[height<=1440]");
  });
});

describe("M3 ffmpeg arg-builders（与已验证命令逐字对齐）", () => {
  it("buildWebpArgs：fps/scale/水印/libwebp/frame_pts", () => {
    const a = buildWebpArgs("/v.mp4", "/t/02_webp");
    expect(a[0]).toBe(process.execPath);
    expect(a).toEqual(expect.arrayContaining(["-y", "-i", "/v.mp4", "-c:v", "libwebp", "-q:v", "80", "-frame_pts", "1"]));
    const vf = a[a.indexOf("-vf") + 1]!;
    expect(vf).toContain("fps=1");
    expect(vf).toContain("scale=640:360");
    expect(vf).toContain("drawtext=text='%{pts\\:hms}'");
    expect(a.at(-1)).toBe("/t/02_webp/%d.webp");
  });

  it("buildHdArgs：1280x720 jpg", () => {
    const a = buildHdArgs("/v.mp4", "/t/01_hd");
    expect(a[a.indexOf("-vf") + 1]).toBe("fps=1,scale=1280:720");
    expect(a).toEqual(expect.arrayContaining(["-q:v", "2", "-frame_pts", "1"]));
    expect(a.at(-1)).toBe("/t/01_hd/%d.jpg");
  });
});
