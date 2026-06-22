/**
 * 唯一新增组件：geminiClient（AI 集成文档 §1）。
 * 输入素材 → 输出 Article。外部只认本文件的接口，内部用官方 SDK 实现。
 * 将来换裸 HTTP / 换模型 / 换供应商，只改这一个文件，M7 其余逻辑不动。
 *
 * SDK：@google/genai（GoogleGenAI 类），纯 JS、不带原生二进制，不涉及 electron-rebuild。
 * 字段名已对 @google/genai@1.52.0 核对：
 *   - new GoogleGenAI({ apiKey })
 *   - ai.models.generateContent({ model, contents, config:{ responseMimeType, responseSchema } })
 *   - contents 接受 Part[]（{text} | {inlineData:{data,mimeType}}）
 *   - 响应 res.text 是 getter（string | undefined）
 * 换裸 HTTP / 换供应商时只改本文件。
 */
import { GoogleGenAI } from "@google/genai";
import type { Article } from "@shared/types";
import { articleResponseSchema } from "./schema.ts";
import { parseAndValidateArticle } from "./parse.ts";
import type { ImagePart } from "./images.ts";

export interface GenerateArticleInput {
  /** 代表帧或宫格图。 */
  images: ImagePart[];
  /** 已清洗字幕（与半自动同源）。 */
  subtitles: string;
  /** 模板渲染后的提示词（与半自动同一套模板）。 */
  prompt: string;
}

export interface GeminiClient {
  generateArticle(input: GenerateArticleInput): Promise<Article>;
}

export interface GeminiClientOptions {
  /** 引擎从本地安全存储取；绝不来自渲染进程明文（铁律 #6）。 */
  apiKey: string;
  /** 可配置模型，如 "gemini-2.5-flash"。 */
  model: string;
}

export function createGeminiClient(opts: GeminiClientOptions): GeminiClient {
  if (!opts.apiKey) throw new Error("缺少 Gemini API Key");
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });

  return {
    async generateArticle(input: GenerateArticleInput): Promise<Article> {
      const contents = [
        { text: input.prompt },
        { text: input.subtitles },
        ...input.images.map((im) => ({
          inlineData: { data: im.base64, mimeType: im.mimeType },
        })),
      ];
      const res = await ai.models.generateContent({
        model: opts.model,
        contents,
        config: {
          responseMimeType: "application/json",
          responseSchema: articleResponseSchema,
        },
      });
      // res.text 是 getter（string | undefined）；空串交给 parse 抛"空响应"。
      return parseAndValidateArticle(res.text ?? "");
    },
  };
}
