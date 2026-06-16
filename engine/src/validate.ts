/**
 * Article 形状校验（半自动回填的人工 JSON 不可信，落库前校验）。
 * 校验通过返回强类型 Article；不通过抛出可读错误。与 shared/types.ts 的 Article 契约对齐。
 * 铁律 #4：body 必须纯净；这里只做结构校验，不混入 notes/CoT 到 body。
 */
import type { Article, ArticlePage, ArticleMeta } from "@shared/types";

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((s) => typeof s === "string");
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Article 校验失败: ${msg}`);
}

export function validateArticle(input: unknown): Article {
  assert(input && typeof input === "object", "顶层必须是对象");
  const obj = input as Record<string, unknown>;

  assert(Array.isArray(obj.pages), "pages 必须是数组");
  assert((obj.pages as unknown[]).length > 0, "pages 不能为空");
  const pages: ArticlePage[] = (obj.pages as unknown[]).map((p, i) => {
    assert(p && typeof p === "object", `pages[${i}] 必须是对象`);
    const page = p as Record<string, unknown>;
    assert(typeof page.subhead === "string", `pages[${i}].subhead 必须是字符串`);
    assert(typeof page.image === "string", `pages[${i}].image 必须是字符串(HH_MM_SS)`);
    assert(typeof page.body === "string", `pages[${i}].body 必须是字符串`);
    return { subhead: page.subhead, image: page.image, body: page.body };
  });

  assert(obj.meta && typeof obj.meta === "object", "meta 必须是对象");
  const m = obj.meta as Record<string, unknown>;
  assert(isStringArray(m.titles), "meta.titles 必须是字符串数组");
  assert(isStringArray(m.keywords), "meta.keywords 必须是字符串数组");
  assert(typeof m.description === "string", "meta.description 必须是字符串");
  const meta: ArticleMeta = {
    titles: m.titles as string[],
    keywords: m.keywords as string[],
    description: m.description as string,
  };

  const article: Article = { pages, meta };

  // notes 可选；存在则按字段挑出（任何额外字段忽略，绝不进 body/docx）。
  if (obj.notes && typeof obj.notes === "object") {
    const n = obj.notes as Record<string, unknown>;
    const notes: Article["notes"] = {};
    if (typeof n.frameworkRationale === "string") notes.frameworkRationale = n.frameworkRationale;
    if (typeof n.imageRationale === "string") notes.imageRationale = n.imageRationale;
    if (Object.keys(notes).length > 0) article.notes = notes;
  }

  return article;
}
