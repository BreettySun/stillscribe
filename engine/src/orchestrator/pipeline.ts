/**
 * 可复用流水线：把 run.ts 内联的 M2→M8 顺序逻辑抽出来，命令行(run.ts)与编排器(queue.ts)共用，
 * 杜绝两份"影子流程"。每步幂等、产物落盘、可单步重跑（CLAUDE.md 铁律 #7）。
 *
 * 边界：runToGrids 跑到"喂 AI 之前"（M2→M6）；runDocx 单独做 M8。
 * 这条缝正好是半自动(semi)的 awaiting_review 停顿点——grids 出来后等人工回填 article，再 export 出 docx。
 *
 * 取消：步与步之间用 ckCancel 检查 signal；同时把 signal 透传进模块（download/抽帧等），
 * 让长命令在中途收到 abort 即 SIGKILL 子进程立即中断，而非等命令跑完才响应。
 */
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULTS, type Article, type StepProgress, type TaskParams } from "@shared/types";
import { TaskDir, matchFiles } from "../paths.ts";
import { fetchVideoInfo, download } from "../modules/m2-download.ts";
import { generateFrames } from "../modules/m3-frames.ts";
import { selectRepresentatives, writeManifest } from "../modules/m5-select.ts";
import { buildGrids } from "../modules/m6-grids.ts";
import { generateArticle, type GenerateResult } from "../modules/m7/index.ts";
import type { GeminiClient } from "../modules/m7/geminiClient.ts";
import type { AIImageSource } from "@shared/types";
import { buildDocx } from "../modules/m8-docx.ts";

export interface PipelineHooks {
  /** 工作根目录（任务目录在其下创建）。 */
  workRoot: string;
  /** 取消信号。 */
  signal?: AbortSignal;
  /** --cookies-from-browser（命令行用；server 端通常 undefined）。 */
  browser?: string;
  /** Netscape cookies.txt 路径（--cookies）；优先于 browser，Electron 下更可靠。 */
  cookiesFile?: string;
  /** M2 拿到 videoId/title 并建好目录后回调（编排器用来回填 workDir/videoTitle）。 */
  onInfo?(info: { workDir: string; videoTitle: string }): void | Promise<void>;
  /** 每进入一步回调一次（编排器据此更新 currentStep 并推 SSE）。 */
  onStep?(progress: StepProgress): void | Promise<void>;
}

export interface GridsResult {
  taskDir: TaskDir;
  videoId: string;
  videoTitle: string;
  /** webp 全集帧数。 */
  frames: number;
  /** 宫格图路径列表。 */
  grids: string[];
}

function ckCancel(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("任务已取消");
}

/** runToGrids 实际推进的步骤顺序，用于把单步进度折算成整条流水线的总进度 0..1。 */
const GRID_STEPS: StepProgress["step"][] = ["download", "frames", "dedup", "grids"];

/** 整体进度 = (步索引 + 步内细分 sub) / 步数；sub 省略时落在该步起点。 */
export function overallRatio(step: StepProgress["step"], sub?: number): number | undefined {
  const i = GRID_STEPS.indexOf(step);
  if (i < 0) return undefined;
  const within = Math.min(Math.max(sub ?? 0, 0), 1);
  return (i + within) / GRID_STEPS.length;
}

async function listWebpStems(webpDir: string): Promise<string[]> {
  const webps = await matchFiles(webpDir, "*.webp");
  return webps.map((e) => e.slice(0, -".webp".length)).sort();
}

/** 跑 M2→M6（下载→抽帧→去重→宫格），停在"喂 AI 之前"。幂等。 */
export async function runToGrids(params: TaskParams, hooks: PipelineHooks): Promise<GridsResult> {
  const threshold = params.dedupThreshold ?? DEFAULTS.dedupThreshold;
  const emit = (step: StepProgress["step"], message: string, sub?: number) => {
    const ratio = overallRatio(step, sub);
    return hooks.onStep?.({ step, message, ...(ratio != null ? { ratio } : {}) });
  };

  ckCancel(hooks.signal);
  await emit("download", "取视频信息…");
  const { videoId, title } = await fetchVideoInfo(params.url, hooks.browser, hooks.cookiesFile, hooks.signal);
  const td = TaskDir.create(hooks.workRoot, videoId, title);
  await hooks.onInfo?.({ workDir: td.root, videoTitle: title });

  ckCancel(hooks.signal);
  await emit("download", `下载 (<=${params.quality}p)…`, 0);
  const { mp4 } = await download(
    params.url, td.source, params.quality, hooks.browser, hooks.cookiesFile, hooks.signal,
    (r) => void emit("download", `下载 (<=${params.quality}p)… ${Math.round(r * 100)}%`, r),
  );

  ckCancel(hooks.signal);
  await emit("frames", "抽帧 (fps=1 → webp 640x360+水印 / hd 1280x720)…", 0);
  const frames = await generateFrames(
    mp4, td.webp, td.hd, hooks.signal,
    (r) => void emit("frames", `抽帧 (fps=1 → webp / hd)… ${Math.round(r * 100)}%`, r),
  );

  ckCancel(hooks.signal);
  let kept: string[];
  if (params.dedup) {
    await emit("dedup", `去重选代表帧 (phash, threshold=${threshold})…`);
    kept = await selectRepresentatives(td.webp, threshold);
    await writeManifest(td.representativesJson, kept, threshold);
  } else {
    await emit("dedup", "跳过去重（dedup=false），用逐秒全集…");
    kept = await listWebpStems(td.webp);
    await writeManifest(td.representativesJson, kept, 0);
  }

  ckCancel(hooks.signal);
  await emit("grids", `拼宫格图 (${DEFAULTS.gridCols}x${DEFAULTS.gridRows}/组)…`);
  const grids = await buildGrids(td.webp, td.grids, kept);

  return { taskDir: td, videoId, videoTitle: title, frames, grids };
}

export interface ArticleDeps {
  /** 注入的 Gemini 客户端（queue 据配置构造）。 */
  client: GeminiClient;
  videoTitle: string;
  imageSource: AIImageSource;
  /** 本次提交的自定义提示词模板全文；省略=用引擎默认模板。 */
  promptOverride?: string;
  /** 结构化输出失败重试次数。 */
  retries?: number;
}

/**
 * M7（auto 模式）：素材 → Gemini → Article，落盘 article.json，停在"喂 AI 之后"。
 * 失败抛错由调用方降级到半自动 UI（AI 集成文档 §6）。semi 模式不走这里。
 */
export async function runArticle(
  taskDir: TaskDir,
  deps: ArticleDeps,
  onStep?: (progress: StepProgress) => void | Promise<void>,
): Promise<GenerateResult> {
  await onStep?.({ step: "article", message: "调用 Gemini 生成文章…" });
  return generateArticle({
    taskDir,
    videoTitle: deps.videoTitle,
    imageSource: deps.imageSource,
    client: deps.client,
    ...(deps.promptOverride != null ? { promptOverride: deps.promptOverride } : {}),
    ...(deps.retries != null ? { retries: deps.retries } : {}),
    onProgress: (message) => void onStep?.({ step: "article", message }),
  });
}

export interface DocxResult {
  docxPath: string;
  /** docx 二进制（buffer-first）：调用方可直接喂飞书导入，省去再次读盘（《飞书集成》§2）。 */
  buffer: Buffer;
  warnings: string[];
}

/**
 * M8：读 Article 程序化生成 docx。返回内存 buffer + 落盘留底路径。
 * buffer-first：buffer 既写盘留底（兜底/本地下载），也供 M9 直接喂飞书导入。幂等由调用方决定。
 */
export async function runDocx(
  article: Article,
  taskDir: TaskDir,
  onStep?: (progress: StepProgress) => void | Promise<void>,
): Promise<DocxResult> {
  await onStep?.({ step: "docx", message: "程序化生成 docx…" });
  mkdirSync(path.dirname(taskDir.docx), { recursive: true }); // 幂等：恢复/重导时确保 article/ 存在
  const { buffer, warnings } = await buildDocx(article, taskDir.hd);
  await writeFile(taskDir.docx, buffer); // 落盘留底
  return { docxPath: taskDir.docx, buffer, warnings };
}
