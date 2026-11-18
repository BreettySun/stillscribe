import { describe, it, expect } from "vitest";
import { cleanSrt } from "./subtitles.ts";
import { parseAndValidateArticle } from "./parse.ts";
import { articleJsonSchema } from "./schema.ts";
import { renderPrompt, loadPromptTemplate } from "./prompt.ts";

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

describe("renderPrompt 提示词渲染", () => {
  it("override 模板优先，并替换 {{var}} 占位", async () => {
    const out = await renderPrompt(
      { videoTitle: "x", imageCount: 3 },
      "T={{videoTitle}}/{{imageCount}}",
    );
    expect(out).toBe("T=x/3");
  });

  it("不传 override 时用默认模板（与 loadPromptTemplate 同源）", async () => {
    const out = await renderPrompt({ videoTitle: "标题", imageCount: 5 });
    const tpl = await loadPromptTemplate();
    const expected = tpl
      .replace(/\{\{\s*videoTitle\s*\}\}/g, "标题")
      .replace(/\{\{\s*imageCount\s*\}\}/g, "5");
    expect(out).toBe(expected);
  });

  it("空串 override 视为未传，回退默认模板", async () => {
    const withEmpty = await renderPrompt({ videoTitle: "a", imageCount: 1 }, "");
    const withDefault = await renderPrompt({ videoTitle: "a", imageCount: 1 });
    expect(withEmpty).toBe(withDefault);
  });
});

describe("articleJsonSchema 镜像 Article 契约", () => {
  it("顶层 required 含 pages/meta，且 body 在 page required 内", () => {
    expect(articleJsonSchema.required).toEqual(["pages", "meta"]);
    expect(articleJsonSchema.properties.pages.items.required).toContain("body");
  });

  it("全部 type 为小写的标准 JSON Schema", () => {
    expect(JSON.stringify(articleJsonSchema)).not.toMatch(/"type":"[A-Z]/);
    expect((articleJsonSchema as any).type).toBe("object");
  });
});
