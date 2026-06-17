import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  secondsToName,
  nameToSeconds,
  slugifyTitle,
  TaskDir,
  resolveWorkRoot,
  cookiesPath,
  resolveCookiesFile,
} from "./paths.ts";

describe("HH_MM_SS 命名约定", () => {
  it("秒数 → 名称", () => {
    expect(secondsToName(0)).toBe("00_00_00");
    expect(secondsToName(83)).toBe("00_01_23");
    expect(secondsToName(3661)).toBe("01_01_01");
  });

  it("名称 → 秒数（往返一致）", () => {
    for (const s of [0, 1, 59, 60, 83, 3599, 3661, 90061]) {
      expect(nameToSeconds(secondsToName(s))).toBe(s);
    }
  });

  it("拒绝非法名称与负数", () => {
    expect(() => nameToSeconds("1_2_3")).toThrow();
    expect(() => nameToSeconds("00:01:23")).toThrow();
    expect(() => secondsToName(-1)).toThrow();
  });
});

describe("slugifyTitle", () => {
  it("保留中文与字母数字，其余转下划线并裁剪", () => {
    expect(slugifyTitle("Hello, World!")).toBe("Hello_World");
    expect(slugifyTitle("视频 标题 2026")).toBe("视频_标题_2026");
    expect(slugifyTitle("a".repeat(80)).length).toBeLessThanOrEqual(50);
  });
});

describe("工作根 / cookies 路径解析", () => {
  const prev = process.env.DIGGO_COOKIES_FILE;
  afterEach(() => {
    if (prev === undefined) delete process.env.DIGGO_COOKIES_FILE;
    else process.env.DIGGO_COOKIES_FILE = prev;
  });

  it("resolveWorkRoot：env 优先，否则 ./work（均绝对化）", () => {
    expect(resolveWorkRoot("/some/root")).toBe("/some/root");
    expect(resolveWorkRoot("rel")).toBe(path.resolve("rel"));
    expect(resolveWorkRoot(undefined)).toBe(path.resolve("work"));
  });

  it("cookiesPath：<workRoot>/cookies.txt", () => {
    expect(cookiesPath("/w")).toBe("/w/cookies.txt");
  });

  it("resolveCookiesFile：缺失→undefined；有 cookie→路径；置空/仅注释头→undefined（P1 回退）", () => {
    delete process.env.DIGGO_COOKIES_FILE;
    const dir = mkdtempSync(path.join(tmpdir(), "diggo-cookies-test-"));
    try {
      // 缺失
      expect(resolveCookiesFile(dir)).toBeUndefined();
      // 仅注释头（被置空成无 cookie）→ 回退
      writeFileSync(cookiesPath(dir), "# Netscape HTTP Cookie File\n\n");
      expect(resolveCookiesFile(dir)).toBeUndefined();
      // 含真 cookie（含 #HttpOnly_ 伪注释 cookie）
      writeFileSync(cookiesPath(dir), "# header\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tx\n");
      expect(resolveCookiesFile(dir)).toBe(cookiesPath(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolveCookiesFile：DIGGO_COOKIES_FILE 显式覆盖优先于 workRoot", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "diggo-cookies-ovr-"));
    try {
      const override = path.join(dir, "explicit.txt");
      writeFileSync(override, "youtube.com\tTRUE\t/\tTRUE\t0\tSID\tx\n");
      process.env.DIGGO_COOKIES_FILE = override;
      expect(resolveCookiesFile("/nonexistent/work")).toBe(override);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("TaskDir 目录约定", () => {
  it("子目录路径符合 §4.2", () => {
    const td = new TaskDir("/work/abc_标题");
    expect(td.source).toBe("/work/abc_标题/source");
    expect(td.hd).toBe("/work/abc_标题/01_hd");
    expect(td.webp).toBe("/work/abc_标题/02_webp");
    expect(td.grids).toBe("/work/abc_标题/03_grids");
    expect(td.docx).toBe("/work/abc_标题/article/article_final.docx");
    expect(td.taskJson).toBe("/work/abc_标题/task.json");
  });
});
