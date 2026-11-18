/**
 * M7 全自动配置：API Key + 模型 + 喂图策略（AI 集成文档 §4/§5）。
 *
 * 【设计】model 与 Key 由代码侧配置，不暴露给最终用户填写：
 *   - 模型：代码默认 AI_DEFAULTS.model（可经 env STILLSCRIBE_GEMINI_MODEL 覆盖，便于开发切档）。
 *   - 喂图策略：代码默认 AI_DEFAULTS.imageSource（可经 env STILLSCRIBE_AI_IMAGE_SOURCE 覆盖）。
 *   - API Key：仅来自 env STILLSCRIBE_GEMINI_API_KEY（由 engine/.env 加载，见 env.ts）。
 * 【铁律 #6】Key 只在本地、绝不硬编码进提交源码、绝不入库；这里只读 env，不接受渲染进程明文。
 */
import { DEFAULT_AI_BASE_URL } from "@shared/ai";
import { AI_DEFAULTS, type AISettings, type AIImageSource, type GeminiModel } from "@shared/types";

export interface ResolvedAIConfig {
  apiKey: string | undefined;
  baseUrl: string;
  model: GeminiModel;
  imageSource: AIImageSource;
}

/** 解析全自动配置（纯读 env + 代码默认；调用前应已 loadDotEnv）。 */
export function resolveAIConfig(): ResolvedAIConfig {
  const apiKey = process.env.STILLSCRIBE_GEMINI_API_KEY || undefined;
  const baseUrl = process.env.STILLSCRIBE_AI_BASE_URL || DEFAULT_AI_BASE_URL;
  const model = process.env.STILLSCRIBE_GEMINI_MODEL || AI_DEFAULTS.model;
  const envSource = process.env.STILLSCRIBE_AI_IMAGE_SOURCE;
  const imageSource: AIImageSource =
    envSource === "grids" || envSource === "frames" ? envSource : AI_DEFAULTS.imageSource;
  return { apiKey, baseUrl, model, imageSource };
}

/** 对渲染进程暴露的只读视图：只说"是否已配置"，绝不回读明文 Key。 */
export function readAISettings(): AISettings {
  const c = resolveAIConfig();
  return { hasApiKey: Boolean(c.apiKey), model: c.model, imageSource: c.imageSource };
}
