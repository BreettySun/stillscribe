/**
 * 视频生成图文文章工具 — 共享类型契约
 * =====================================================
 * 这是前端(Vue) 与 引擎(Node) 的【唯一事实来源】。
 * - 修改本文件即修改契约：前后端必须同步，不得在某一端私自定义"影子结构"。
 * - 要改数据结构：先改这里的类型，再改实现。
 * - 与《视频生成文章-架构文档》v0.4 第 4、5 节对应。
 *
 * 建议放置位置：shared/types.ts（前后端各自从此包导入）。
 */

// ============================================================
// 基础别名
// ============================================================

/** 帧时间戳，格式 "HH_MM_SS"，与帧文件名一致，如 "00_01_23"。 */
export type Timestamp = string;

/** 任务 ID。 */
export type TaskId = string;

/** ISO 8601 日期时间字符串。 */
export type ISODateTime = string;

// ============================================================
// 任务参数（提交时由 UI → 引擎）
// ============================================================

/** 下载画质（使用 "<=" 语义，无对应分辨率时自动降级）。 */
export type VideoQuality = 1080 | 1440;

/** 文章生成模式。auto=调 Gemini API；semi=网页版人工粘贴回填。 */
export type ArticleMode = "auto" | "semi";

/** 发布/导出目标。 */
export type ExportTarget = "local" | "feishu";

export interface TaskParams {
  /** YouTube 视频 URL。 */
  url: string;
  /** 下载画质，默认 1080。 */
  quality: VideoQuality;
  /** 是否去重选代表帧（默认 true）。仅影响喂 AI 的那一份，逐秒全集始终保留。 */
  dedup: boolean;
  /** phash 相似度阈值；省略则用引擎默认值（需按素材校准）。 */
  dedupThreshold?: number;
  /** 文章生成模式。 */
  mode: ArticleMode;
  /** 选用的 Prompt 模板 ID；省略用默认模板。 */
  promptTemplateId?: string;
  /** 是否执行 M10 视频切片（可选、默认 false）。 */
  makeClips?: boolean;
}

/** 批量提交。引擎按限流策略（单批 ≤10、间隔可配）排队。 */
export interface BatchSubmit {
  tasks: TaskParams[];
}

// ============================================================
// 流水线步骤 & 任务状态
// ============================================================

/** 流水线步骤，与模块 M2..M10 对应。 */
export type PipelineStep =
  | "download" // M2
  | "frames"   // M3
  | "dedup"    // M5
  | "grids"    // M6
  | "article"  // M7
  | "docx"     // M8
  | "publish"  // M9
  | "clips";   // M10（可选）

export type TaskStatus =
  | "queued"
  | "running"
  | "awaiting_review" // 等待人工换图/校对（半自动模式或主动校对）
  | "completed"
  | "failed"
  | "canceled";

export interface StepProgress {
  step: PipelineStep;
  /** 进度比例 0..1；不可量化的步骤可省略（视为 indeterminate）。 */
  ratio?: number;
  /** 给人看的简短状态文案。 */
  message?: string;
}

// ============================================================
// 帧
// ============================================================

export interface Frame {
  /** 时间戳，等于文件名主体，如 "00_01_23"。 */
  timestamp: Timestamp;
  /** 01_hd/ 下的 1280x720 高清图路径（换图浏览 + M8 配图源）。 */
  hdPath: string;
  /** 02_webp/ 下的 640x360 + 水印 webp 路径（M5/M6 用）。 */
  webpPath: string;
  /** 是否被 M5 选为代表帧（仅代表帧进入 M6 / 喂 Gemini）。 */
  isRepresentative: boolean;
}

// ============================================================
// 文章（M7 输出 / M8 输入）
// ============================================================

/** 文章的一页：小标题 + 配图 + 正文。 */
export interface ArticlePage {
  /** 小标题。 */
  subhead: string;
  /** 配图：引用某帧的时间戳（必须存在于该任务的帧集合中）。 */
  image: Timestamp;
  /** 正文。【发布用，必须纯净】——不含任何说明性中文/CoT。 */
  body: string;
}

/** 文末元信息。 */
export interface ArticleMeta {
  /** 候选标题（可多个供人工挑选）。 */
  titles: string[];
  keywords: string[];
  description: string;
}

/**
 * 非发布字段：中文说明 / 思维链，仅供人工参考。
 * 【铁律】这些内容绝不进入 ArticlePage.body，也绝不进入 docx。
 */
export interface ArticleNotes {
  /** 文章框架对比说明（中文）。 */
  frameworkRationale?: string;
  /** 配图选择 CoT（中文）。 */
  imageRationale?: string;
}

export interface Article {
  pages: ArticlePage[];
  meta: ArticleMeta;
  notes?: ArticleNotes;
}

// ============================================================
// 任务快照（task.json / 查询返回）
// ============================================================

export interface Task {
  id: TaskId;
  params: TaskParams;
  status: TaskStatus;
  /** 当前所处步骤（running 时有意义）。 */
  currentStep?: PipelineStep;
  /** 视频标题（M2 解析后填充）。 */
  videoTitle?: string;
  /** 任务工作目录绝对路径。 */
  workDir: string;
  /** M7 完成后填充。 */
  article?: Article;
  /** M8 产物 docx 路径。 */
  outputDocx?: string;
  /** 失败时的错误说明。 */
  error?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ============================================================
// HTTP API 契约（引擎暴露于 127.0.0.1）
// ============================================================
//
//  POST /tasks               body: TaskParams | BatchSubmit   -> SubmitResult
//  GET  /tasks                                                -> Task[]
//  GET  /tasks/:id                                            -> Task
//  GET  /tasks/:id/frames                                     -> Frame[]  (逐秒全集，供换图)
//  POST /tasks/:id/swap      body: SwapImageRequest           -> Task
//  POST /tasks/:id/article   body: Article (半自动回填)        -> Task
//  POST /tasks/:id/export    body: ExportRequest              -> ExportResult
//  POST /tasks/:id/cancel                                     -> Task
//

export interface SubmitResult {
  ids: TaskId[];
}

export interface SwapImageRequest {
  /** 第几页（ArticlePage 在 pages 中的索引）。 */
  pageIndex: number;
  /** 换成哪一帧的时间戳。 */
  image: Timestamp;
}

export interface ExportRequest {
  target: ExportTarget;
}

export interface ExportResult {
  docxPath: string;
  /** target=feishu 时返回。 */
  feishuUrl?: string;
}

// ============================================================
// WebSocket / SSE 事件（引擎 → UI 推送）
// ============================================================

export type EngineEvent =
  | { type: "task_created"; task: Task }
  | { type: "status_changed"; taskId: TaskId; status: TaskStatus }
  | { type: "progress"; taskId: TaskId; progress: StepProgress }
  | { type: "awaiting_review"; taskId: TaskId; article: Article }
  | { type: "completed"; taskId: TaskId; outputDocx: string }
  | { type: "failed"; taskId: TaskId; error: string };

// ============================================================
// 默认值（建议常量，前后端共用，避免魔法数）
// ============================================================

export const DEFAULTS = {
  quality: 1080 as VideoQuality,
  dedup: true,
  /** phash 去重默认阈值（64 位汉明距离）；需按真实素材校准。 */
  dedupThreshold: 15,
  mode: "semi" as ArticleMode,
  /** 限流：单批最大任务数。 */
  maxBatchSize: 10,
  /** 限流：批次间最小间隔（毫秒），约 2 小时。 */
  minBatchIntervalMs: 2 * 60 * 60 * 1000,
  /** 宫格图布局：列 × 行。 */
  gridCols: 10,
  gridRows: 5,
} as const;
