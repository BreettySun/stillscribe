import { describe, it, expect } from "vitest";
import { cleanSrt } from "./subtitles.ts";
import { parseAndValidateArticle } from "./parse.ts";
import { articleResponseSchema } from "./schema.ts";

describe("cleanSrt 字幕清洗", () => {
  it("剥离序号/时间码/标签，合并紧邻重复行", () => {
    const srt = [
      "1",
      "00:00:01,000 --> 00:00:03,000",
      "<c>Hello</c> world",
      "",
      "2",
      "00:00:03,000 --> 00:00:05,000",
      "Hello world",
      "next line",
      "",
    ].join("\n");
    expect(cleanSrt(srt)).toBe("Hello world\nnext line");
  });

  it("空输入得空串", () => {
    expect(cleanSrt("")).toBe("");
  });
});

describe("parseAndValidateArticle", () => {
  const valid = JSON.stringify({
    pages: [{ subhead: "标题", image: "00_00_01", body: "正文" }],
    meta: { titles: ["t"], keywords: ["k"], description: "d" },
  });

  it("解析合法 JSON 为 Article", () => {
    const a = parseAndValidateArticle(valid);
    expect(a.pages[0]!.image).toBe("00_00_01");
  });

  it("剥离 ```json``` 代码块围栏", () => {
    const a = parseAndValidateArticle("```json\n" + valid + "\n```");
    expect(a.pages).toHaveLength(1);
  });

  it("空响应抛错", () => {
    expect(() => parseAndValidateArticle("   ")).toThrow(/空响应/);
  });

  it("形状不合抛错（缺 meta）", () => {
    expect(() => parseAndValidateArticle(JSON.stringify({ pages: [] }))).toThrow();
  });
});

describe("articleResponseSchema 镜像 Article 契约", () => {
  it("顶层 required 含 pages/meta，且 body 在 page required 内", () => {
    expect(articleResponseSchema.required).toEqual(["pages", "meta"]);
    expect(articleResponseSchema.properties.pages.items.required).toContain("body");
  });
});
