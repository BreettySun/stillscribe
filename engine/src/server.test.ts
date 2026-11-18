import { describe, it, expect } from "vitest";
import path from "node:path";
import { normalizeFormats, resolveWithin } from "./server.ts";

const DIR = "/tmp/stillscribe-task/01_hd";

describe("resolveWithin 路径穿越防护", () => {
  it("允许合法 basename", () => {
    expect(resolveWithin(DIR, "00_01_23.jpg")).toBe(path.join(DIR, "00_01_23.jpg"));
    expect(resolveWithin(DIR, "grid_001.jpg")).toBe(path.join(DIR, "grid_001.jpg"));
  });

  it.each([
    "..",
    ".",
    "../secret",
    "../../etc/passwd",
    "sub/dir.jpg",
    "a\\b.jpg",
    "x\0.jpg",
    "",
  ])("拒绝危险输入: %j", (bad) => {
    expect(resolveWithin(DIR, bad)).toBeNull();
  });
});

describe("normalizeFormats 导出格式校验", () => {
  it("省略 → 全部格式", () => {
    expect(normalizeFormats(undefined)).toEqual(["docx", "markdown", "html"]);
  });

  it("合法数组去重后原序返回", () => {
    expect(normalizeFormats(["html", "markdown", "html"])).toEqual(["html", "markdown"]);
  });

  it.each([[[]], ["markdown"], [["pdf"]], [["docx", "feishu"]], [{}]])("拒绝非法输入: %j", (bad) => {
    expect(() => normalizeFormats(bad)).toThrow();
  });
});
