import { describe, it, expect } from "vitest";
import { validateArticle } from "./validate.ts";

const VALID = {
  pages: [
    { subhead: "Grand Entrance", image: "00_01_23", body: "Two sentences here." },
  ],
  meta: { titles: ["A", "B"], keywords: ["k1", "k2"], description: "desc" },
};

describe("validateArticle", () => {
  it("接受合法 Article 并原样取出页/meta", () => {
    const a = validateArticle(VALID);
    expect(a.pages).toHaveLength(1);
    expect(a.pages[0]).toEqual(VALID.pages[0]);
    expect(a.meta.titles).toEqual(["A", "B"]);
    expect(a.notes).toBeUndefined();
  });

  it("挑出已知 notes 字段，丢弃未知字段（绝不进 body）", () => {
    const a = validateArticle({
      ...VALID,
      notes: { imageRationale: "中文 CoT", junk: 123 },
    });
    expect(a.notes).toEqual({ imageRationale: "中文 CoT" });
  });

  it.each([
    ["非对象", 42],
    ["缺 pages", { meta: VALID.meta }],
    ["pages 空", { pages: [], meta: VALID.meta }],
    ["页缺 image", { pages: [{ subhead: "s", body: "b" }], meta: VALID.meta }],
    ["meta.titles 非数组", { pages: VALID.pages, meta: { titles: "x", keywords: [], description: "" } }],
    ["缺 meta", { pages: VALID.pages }],
  ])("拒绝：%s", (_label, bad) => {
    expect(() => validateArticle(bad)).toThrow(/Article 校验失败/);
  });
});
