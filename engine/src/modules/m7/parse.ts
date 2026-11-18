/**
 * 解析并校验模型返回的 JSON（AI 集成文档 §1/§2）。
 * 复用半自动那套 validateArticle —— 全自动与半自动产出同一个 Article 结构，下游全部复用。
 *
 * 这里只做 JSON 解析 + 形状校验。"image 时间戳是否在本任务帧集合内"的语义校验
 * 需要帧集合，放在编排层（index.ts），不属于纯解析。
 */
import type { Article } from "@shared/types";
import { validateArticle } from "../../validate.ts";

/** 把模型文本解析成 JSON；偶发包在 ```json``` 代码块里，剥一层再试。无法解析时抛错。 */
export function parseModelJson(trimmed: string): unknown {
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
    if (!fenced) throw new Error("模型返回非 JSON，无法解析");
    return JSON.parse(fenced[1]!.trim());
  }
}

export function parseAndValidateArticle(text: string): Article {
  const trimmed = (text ?? "").trim();
  if (!trimmed) throw new Error("模型返回空响应");
  return validateArticle(parseModelJson(trimmed)); // 形状不合抛错 → 上层重试/降级
}
