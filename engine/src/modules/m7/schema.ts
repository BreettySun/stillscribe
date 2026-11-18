/**
 * M7 全自动：Article 的标准 JSON Schema —— 镜像 shared/types.ts 的 `Article`，经通用接口的
 * response_format 交给模型服务，在接口层强制结构（AI 集成文档 §2）。
 *
 * 半自动靠人眼保证粘回 JSON 合法；全自动没人把关，必须让模型直接吐出符合 Article 形状的 JSON：
 *   pages[].{subhead,image,body} + meta{titles,keywords,description} + 可选 notes。
 *
 * 【铁律 #4】中文说明 / CoT 在 schema 层就与 body 分到 notes，从源头杜绝混入正文。
 */
export const articleJsonSchema = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      description: "文章页：每页一个小标题 + 一张配图（帧时间戳）+ 一段正文。",
      items: {
        type: "object",
        properties: {
          subhead: { type: "string", description: "小标题。" },
          image: {
            type: "string",
            description: "配图：引用某帧的时间戳，格式 HH_MM_SS，必须取自本任务提供的帧集合。",
          },
          body: {
            type: "string",
            description: "正文。【发布用，必须纯净】不含任何说明性中文 / CoT。",
          },
        },
        required: ["subhead", "image", "body"],
      },
    },
    meta: {
      type: "object",
      properties: {
        titles: {
          type: "array",
          items: { type: "string" },
          description: "候选标题（可多个供人工挑选）。",
        },
        keywords: { type: "array", items: { type: "string" } },
        description: { type: "string" },
      },
      required: ["titles", "keywords", "description"],
    },
    notes: {
      type: "object",
      description: "非发布字段：中文说明 / 思维链，仅供人工参考；绝不进 body / docx。",
      properties: {
        frameworkRationale: { type: "string", description: "文章框架对比说明（中文）。" },
        imageRationale: { type: "string", description: "配图选择 CoT（中文）。" },
      },
    },
  },
  required: ["pages", "meta"],
} as const;
