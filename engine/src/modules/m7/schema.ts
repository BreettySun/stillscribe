/**
 * M7 全自动：responseSchema —— 镜像 shared/types.ts 的 `Article`，在 API 层强制结构（AI 集成文档 §2）。
 *
 * 半自动靠人眼保证粘回 JSON 合法；全自动没人把关，必须让 Gemini 直接吐出符合 Article 形状的 JSON：
 *   pages[].{subhead,image,body} + meta{titles,keywords,description} + 可选 notes。
 *
 * 【铁律 #4】中文说明 / CoT 在 schema 层就与 body 分到 notes，从源头杜绝混入正文。
 *
 * 表达为纯对象，geminiClient 原样透传给 SDK 的 responseSchema（其类型为 `Schema | unknown`，接受本对象）。
 * 【注意】type 值用大写，对齐 @google/genai 的 Type 枚举（OBJECT/ARRAY/STRING，OpenAPI 子集），
 * 这是 Gemini responseSchema 的要求——小写会在 API 端校验失败（已对 @google/genai@1.52.0 核对）。
 */
export const articleResponseSchema = {
  type: "OBJECT",
  properties: {
    pages: {
      type: "ARRAY",
      description: "文章页：每页一个小标题 + 一张配图（帧时间戳）+ 一段正文。",
      items: {
        type: "OBJECT",
        properties: {
          subhead: { type: "STRING", description: "小标题。" },
          image: {
            type: "STRING",
            description: "配图：引用某帧的时间戳，格式 HH_MM_SS，必须取自本任务提供的帧集合。",
          },
          body: {
            type: "STRING",
            description: "正文。【发布用，必须纯净】不含任何说明性中文 / CoT。",
          },
        },
        required: ["subhead", "image", "body"],
      },
    },
    meta: {
      type: "OBJECT",
      properties: {
        titles: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "候选标题（可多个供人工挑选）。",
        },
        keywords: { type: "ARRAY", items: { type: "STRING" } },
        description: { type: "STRING" },
      },
      required: ["titles", "keywords", "description"],
    },
    notes: {
      type: "OBJECT",
      description: "非发布字段：中文说明 / 思维链，仅供人工参考；绝不进 body / docx。",
      properties: {
        frameworkRationale: { type: "STRING", description: "文章框架对比说明（中文）。" },
        imageRationale: { type: "STRING", description: "配图选择 CoT（中文）。" },
      },
    },
  },
  required: ["pages", "meta"],
} as const;
