/**
 * 可复用流水线：把 run.ts 内联的 M2→M8 顺序逻辑抽出来，命令行(run.ts)与编排器(queue.ts)共用，
 * 杜绝两份"影子流程"。每步幂等、产物落盘、可单步重跑（CLAUDE.md 铁律 #7）。
 *
 * 边界：runToGrids 跑到"喂 AI 之前"（M2→M6）；runDocx 单独做 M8。
 * 这条缝正好是半自动(semi)的 awaiting_review 停顿点——grids 出来后等人工回填 article，再 export 出 docx。
 *
 * 取消：在每步之间检查 signal（粗粒度）。注：模块内单条长命令（如 download/抽帧）暂不被中途打断，
 * 仅在步与步之间响应取消——首版够用，模块级 signal 透传留待后续。
 */
import { mkdirSync } from "node:fs";
import { glob } from "node:fs/promises";
import path from "node:path";
import { DEFAULTS, type Article, type StepProgress, type TaskParams } from "@shared/types";
import { TaskDir } from "../paths.ts";
import { fetchVideoInfo, download } from "../modules/m2-download.ts";
import { generateFrames } from "../modules/m3-frames.ts";
import { selectRepresentatives, writeManifest } from "../modules/m5-select.ts";
import { buildGrids } from "../modules/m6-grids.ts";
import { buildDocx } from "../modules/m8-docx.ts";

export interface PipelineHooks {
  /** 工作根目录（任务目录在其下创建）。 */
  workRoot: string;
  /** 取消信号。 */
  signal?: AbortSignal;
  /** --cookies-from-browser（命令行用；server 端通常 undefined）。 */
  browser?: string;
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

async function listWebpStems(webpDir: string): Promise<string[]> {
  const stems: string[] = [];
  for await (const entry of glob("*.webp", { cwd: webpDir })) {
    stems.push(entry.slice(0, -".webp".length));
  }
  return stems.sort();
}

/** 跑 M2→M6（下载→抽帧→去重→宫格），停在"喂 AI 之前"。幂等。 */
export async function runToGrids(params: TaskParams, hooks: PipelineHooks): Promise<GridsResult> {
  const threshold = params.dedupThreshold ?? DEFAULTS.dedupThreshold;
  const emit = (step: StepProgress["step"], message: string) => hooks.onStep?.({ step, message });

  ckCancel(hooks.signal);
  await emit("download", "取视频信息…");
  const { videoId, title } = await fetchVideoInfo(params.url, hooks.browser);
  const td = TaskDir.create(hooks.workRoot, videoId, title);
  await hooks.onInfo?.({ workDir: td.root, videoTitle: title });

  ckCancel(hooks.signal);
  await emit("download", `下载 (<=${params.quality}p)…`);
  const { mp4 } = await download(params.url, td.source, params.quality, hooks.browser);

  ckCancel(hooks.signal);
  await emit("frames", "抽帧 (fps=1 → webp 640x360+水印 / hd 1280x720)…");
  const frames = await generateFrames(mp4, td.webp, td.hd);

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

export interface DocxResult {
  docxPath: string;
  warnings: string[];
}

/** M8：读 Article 程序化生成 docx。幂等由调用方决定（已存在则可跳过）。 */
export async function runDocx(
  article: Article,
  taskDir: TaskDir,
  onStep?: (progress: StepProgress) => void | Promise<void>,
): Promise<DocxResult> {
  await onStep?.({ step: "docx", message: "程序化生成 docx…" });
  mkdirSync(path.dirname(taskDir.docx), { recursive: true }); // 幂等：恢复/重导时确保 article/ 存在
  const warnings = await buildDocx(article, taskDir.hd, taskDir.docx);
  return { docxPath: taskDir.docx, warnings };
}
