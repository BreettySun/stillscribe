/**
 * M7 全自动编排：素材(代表帧/宫格图 + 字幕) + 提示词 → articleClient → Article（AI 集成文档 §1~§3）。
 *
 * 与半自动产出同一个 Article，下游全部复用：校验、写 article/article.json、awaiting_review、
 * 人工校对、M8 docx —— 都不动。本模块只替掉"等人工粘贴"那一停。
 *
 * 失败兜底（§6）：本模块抛错即代表全自动失败，由调用方(queue)降级到半自动 UI 让人工接手。
 */
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { AIImageSource, Article } from "@shared/types";
import { TaskDir, matchFiles } from "../../paths.ts";
import { collectImages } from "./images.ts";
import { renderPrompt } from "./prompt.ts";
import { findSubtitlePath, loadCleanSubtitles } from "./subtitles.ts";
import type { ArticleClient } from "./articleClient.ts";
import { AIRequestError } from "./chat.ts";

export { createArticleClient } from "./articleClient.ts";
export type { ArticleClient } from "./articleClient.ts";

export interface GenerateOptions {
  /** 本任务工作目录。 */
  taskDir: TaskDir;
  /** 视频标题（进提示词）。 */
  videoTitle: string;
  /** 喂图策略。 */
  imageSource: AIImageSource;
  /** 本次提交的自定义提示词模板全文；省略=用引擎默认模板。 */
  promptOverride?: string;
  /** 已注入的客户端（依赖倒置，便于测试 / 换供应商）。 */
  client: ArticleClient;
  /** 结构化输出失败重试次数（§6：重试几次仍失败再降级）。默认 2。 */
  retries?: number;
  /** 模型名，仅用于进度与错误文案。 */
  modelLabel?: string;
  /** 进度回调（喂模型时给个文案）。 */
  onProgress?(message: string): void;
}

export interface GenerateResult {
  article: Article;
  /** 非致命提示：如 image 时间戳不在帧集合内（待人工换图）。 */
  warnings: string[];
}

/** 收集本任务全部合法帧时间戳（hd 全集），用于校验 image 引用。 */
async function frameTimestamps(td: TaskDir): Promise<Set<string>> {
  const hd = await matchFiles(td.hd, "*.jpg");
  return new Set(hd.map((f) => f.slice(0, -".jpg".length)));
}

/** 调一次模型（含重试）拿 Article。 */
async function generateWithRetry(
  client: ArticleClient,
  input: { images: Awaited<ReturnType<typeof collectImages>>; subtitles: string; prompt: string },
  retries: number,
): Promise<Article> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await client.generateArticle(input);
    } catch (err) {
      // 被取消不是失败：不重试、不包装，原样抛给调用方（queue 据此把任务落 canceled）。
      if (err instanceof AIRequestError && err.kind === "aborted") throw err;
      lastErr = err;
    }
  }
  throw new Error(
    `模型生成失败（重试 ${retries} 次）: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/** 把 Article 落盘到 article/article.json（铁律 #7：产物落盘、可单步重跑）。 */
export async function writeArticleJson(td: TaskDir, article: Article): Promise<void> {
  mkdirSync(td.articleDir, { recursive: true });
  await writeFile(td.articleJson, JSON.stringify(article, null, 2), "utf-8");
}

/** 全自动主流程：备料 → 调 client → 校验 image 引用 → 落盘 article.json。 */
export async function generateArticle(opts: GenerateOptions): Promise<GenerateResult> {
  const { taskDir: td, client, imageSource } = opts;
  const warnings: string[] = [];

  opts.onProgress?.("收集喂模型的素材（图片 + 字幕）…");
  const images = await collectImages(td, imageSource);
  if (images.length === 0) throw new Error("没有可喂模型的图片（M5/M6 未产出？）");
  const srt = await findSubtitlePath(td.source);
  const subtitles = await loadCleanSubtitles(srt);
  const prompt = await renderPrompt(
    { videoTitle: opts.videoTitle, imageCount: images.length },
    opts.promptOverride,
  );

  opts.onProgress?.(
    `调用模型${opts.modelLabel ? ` ${opts.modelLabel} ` : ""}生成文章（${images.length} 图，${imageSource}）…`,
  );
  const article = await generateWithRetry(client, { images, subtitles, prompt }, opts.retries ?? 2);

  // 语义校验（§2）：image 时间戳须在帧集合内，否则标记待人工换图（不阻断，进 awaiting_review 处理）。
  const valid = await frameTimestamps(td);
  for (const [i, p] of article.pages.entries()) {
    if (!valid.has(p.image)) {
      warnings.push(`pages[${i}].image="${p.image}" 不在帧集合内，待人工换图`);
    }
  }

  await writeArticleJson(td, article);
  return { article, warnings };
}
