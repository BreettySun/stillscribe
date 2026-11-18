import { describe, it, expect, beforeAll } from "vitest";

// toolPath 会校验文件存在；测试与机器解耦，用 node 自身可执行文件冒充工具路径。
// 只断言生成的命令“参数形状”，不实际调用工具。
beforeAll(() => {
  process.env.STILLSCRIBE_YT_DLP = process.execPath;
  process.env.STILLSCRIBE_FFMPEG = process.execPath;
  // deno 为可选 JS 运行时（解 nsig）：用 node 自身冒充，使 --js-runtimes 参数确定可断言。
  process.env.STILLSCRIBE_DENO = process.execPath;
});

const { buildInfoArgs, buildDownloadArgs, buildSubsArgs } = await import("./m2-download.ts");
const { buildWebpArgs, buildHdArgs } = await import("./m3-frames.ts");

describe("M2 yt-dlp arg-builders（与已验证命令逐字对齐）", () => {
  it("buildInfoArgs", () => {
    expect(buildInfoArgs("URL")).toEqual([
      process.execPath,
      "--js-runtimes", `deno:${process.execPath}`,
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

  it("buildInfoArgs cookiesFile 优先于 browser（用 --cookies，不用 --cookies-from-browser）", () => {
    const a = buildInfoArgs("URL", "chrome", "/tmp/c.txt");
    expect(a).toContain("--cookies");
    expect(a[a.indexOf("--cookies") + 1]).toBe("/tmp/c.txt");
    expect(a).not.toContain("--cookies-from-browser");
    expect(a.at(-1)).toBe("URL");
  });

  it("buildDownloadArgs 带 cookiesFile", () => {
    const a = buildDownloadArgs("URL", "/t/source", 1080, undefined, "/tmp/c.txt");
    expect(a[a.indexOf("--cookies") + 1]).toBe("/tmp/c.txt");
    expect(a).not.toContain("--cookies-from-browser");
  });

  it("buildDownloadArgs 画质/输出模板（视频，不含字幕）", () => {
    const a = buildDownloadArgs("URL", "/t/source", 1080);
    expect(a).toContain("-f");
    expect(a[a.indexOf("-f") + 1]).toBe("bv*[height<=1080]+ba/b[height<=1080]");
    expect(a).toEqual(expect.arrayContaining(["--merge-output-format", "mp4"]));
    // 字幕已拆到 buildSubsArgs，视频命令不再带字幕参数。
    expect(a).not.toContain("--write-subs");
    expect(a).not.toContain("--sub-langs");
    expect(a[a.indexOf("-o") + 1]).toBe("/t/source/%(title).80s [%(id)s].%(ext)s");
    expect(a.at(-1)).toBe("URL");
  });

  it("buildDownloadArgs 1440p", () => {
    const a = buildDownloadArgs("URL", "/t/source", 1440);
    expect(a[a.indexOf("-f") + 1]).toBe("bv*[height<=1440]+ba/b[height<=1440]");
  });

  it("buildSubsArgs：仅精确英文轨（不含自动翻译通配）+ 节流", () => {
    const a = buildSubsArgs("URL", "/t/source");
    expect(a).toEqual(expect.arrayContaining([
      "--skip-download",
      "--write-subs", "--write-auto-subs",
      "--sub-langs", "en,en-orig,en-US,en-GB",
      "--convert-subs", "srt",
      "--sleep-subtitles", "1",
    ]));
    expect(a[a.indexOf("--sub-langs") + 1]).not.toContain("en.*");
    expect(a[a.indexOf("-o") + 1]).toBe("/t/source/%(title).80s [%(id)s].%(ext)s");
    expect(a.at(-1)).toBe("URL");
  });

  it("buildSubsArgs 带 cookiesFile 优先", () => {
    const a = buildSubsArgs("URL", "/t/source", "chrome", "/tmp/c.txt");
    expect(a[a.indexOf("--cookies") + 1]).toBe("/tmp/c.txt");
    expect(a).not.toContain("--cookies-from-browser");
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
