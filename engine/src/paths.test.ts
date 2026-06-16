import { describe, it, expect } from "vitest";
import { secondsToName, nameToSeconds, slugifyTitle, TaskDir } from "./paths.ts";

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
