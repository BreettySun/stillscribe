/**
 * 文章客户端（AI 集成文档 §1）：输入素材 → 输出 Article。
 * 外部只认本文件的接口，内部经通用 chat/completions 客户端（chat.ts）调用任意 OpenAI 兼容服务。
 * 结构化输出的降级（json_schema → json_object → none）由 chatJson 负责；本文件只负责
 * 组装请求内容、把实际用上的级别回报出去、校验返回的 Article。
 */
import type { AIStructuredMode, Article } from "@shared/types";
import { chatJson, type ChatOptions, type ChatPart } from "./chat.ts";
import { articleJsonSchema } from "./schema.ts";
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

export interface ArticleClient {
  generateArticle(input: GenerateArticleInput): Promise<Article>;
}

export interface ArticleClientOptions extends ChatOptions {
  /** 已记住的结构化输出级别；省略 = 从 json_schema 起步。 */
  structuredMode?: AIStructuredMode;
  /** 每次成功后回报实际用上的级别。 */
  onStructuredMode?(mode: AIStructuredMode): void;
}

export function createArticleClient(opts: ArticleClientOptions): ArticleClient {
  const { structuredMode, onStructuredMode, ...chatOpts } = opts;
  return {
    async generateArticle(input: GenerateArticleInput): Promise<Article> {
      const parts: ChatPart[] = [
        { type: "text", text: input.prompt },
        { type: "text", text: input.subtitles },
        ...input.images.map((im): ChatPart => ({ type: "image", base64: im.base64, mimeType: im.mimeType })),
      ];
      const { content, mode } = await chatJson(chatOpts, {
        parts,
        schema: { name: "article", schema: articleJsonSchema },
        ...(structuredMode ? { startMode: structuredMode } : {}),
      });
      onStructuredMode?.(mode);
      // 空串 / 非 JSON / 形状不合都由 parse 抛错，交上层重试或降级。
      return parseAndValidateArticle(content);
    },
  };
}
