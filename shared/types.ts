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

/** 模型 ID（可配置，速度/质量/价格权衡）。各模型服务的 ID 不同，故保留为字符串。 */
export type AIModel = string;

/** @deprecated 改用 AIModel；Task 11 删除。 */
export type GeminiModel = AIModel;

/** 结构化输出方式：json_schema（严格）> json_object（仅保证 JSON）> none（靠提示词约束）。 */
export type AIStructuredMode = "json_schema" | "json_object" | "none";

/** 当前模型服务地址所用 Key 的来源：界面保存 / 环境变量 / 无。 */
export type AIKeySource = "saved" | "env" | "none";

/**
 * 全自动(M7)喂图策略：
 * - "grids" ：发宫格图（每张打包 50 帧，请求体/token 成本低一个量级）。【默认】实测 5'30" 视频可行。
 * - "frames"：发去重后的代表单帧（模型看单帧更清楚，但帧多时图数/体积暴涨，成本高，见 AI 集成文档 §7/§8）。
 */
export type AIImageSource = "frames" | "grids";

/** 保存模型服务设置的增量补丁（均可选）。 */
export interface AISettingsPatch {
	baseUrl?: string;
	model?: string;
	imageSource?: AIImageSource;
}

/** 更新某个服务地址对应的 Key；apiKey 为 null 表示清除。 */
export interface AIKeyUpdate {
	baseUrl: string;
	apiKey: string | null;
}

/** 「测试连接」结果。 */
export interface AITestResult {
	ok: boolean;
	/** 模型是否能看懂图片；第一步就失败时为 null。 */
	seesImage: boolean | null;
	structuredMode: AIStructuredMode | null;
	latencyMs: number;
	error?: string;
}

/**
 * 下载时取哪个浏览器的 cookie（yt-dlp --cookies-from-browser）。
 * YouTube 现常要求登录验证（"Sign in to confirm you're not a bot"），此时必须带 cookie。
 * 取 yt-dlp 支持的常用子集。
 */
export type CookieBrowser = "safari" | "chrome" | "edge" | "firefox" | "opera";

/**
 * 导出格式（M8）。产物一律是本地文件，落在任务目录 article/ 下：
 * - "docx"    ：article_final.docx（配图内嵌）。
 * - "markdown"：article.md + images/（相对路径引用；标题/description/关键词写入 front matter）。
 * - "html"    ：article.html + images/（同目录另出一份图片内嵌的单文件 article.standalone.html）。
 */
export type ExportFormat = "docx" | "markdown" | "html";

/** 全部导出格式（导出请求省略 formats 时的默认集合）。 */
export const EXPORT_FORMATS: readonly ExportFormat[] = ["docx", "markdown", "html"];

/** 各导出格式的主产物绝对路径（只含已导出的格式）。 */
export type ExportOutputs = Partial<Record<ExportFormat, string>>;

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
	/** 用哪个浏览器的 cookie 下载（--cookies-from-browser）；YouTube 需登录验证时必填，省略=不带 cookie。 */
	browser?: CookieBrowser;
	/** 选用的 Prompt 模板 ID；省略用默认模板。 */
	promptTemplateId?: string;
	/** 本次提交使用的提示词模板全文；省略=用引擎默认模板。仅本次提交生效，不回写默认模板。 */
	promptOverride?: string;
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
	| "frames" // M3
	| "dedup" // M5
	| "grids" // M6
	| "article" // M7
	| "export" // M8（docx / Markdown / HTML）
	| "clips"; // M10（可选）

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
 * 【铁律】这些内容绝不进入 ArticlePage.body，也绝不进入任何导出文件（docx / Markdown / HTML）。
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
	/** M8 导出产物路径（按格式；导出过才有）。 */
	outputs?: ExportOutputs;
	/** 失败时的错误说明。 */
	error?: string;
	/** 全自动生成失败（已降级人工回填）的原因；成功得到文章后清空。 */
	autoError?: string;
	createdAt: ISODateTime;
	updatedAt: ISODateTime;
}

// ============================================================
// HTTP API 契约（引擎暴露于 127.0.0.1）
// ============================================================
//
//  鉴权（对下列全部路由生效，含静态资源与事件流；实现见 engine/src/auth.ts）：
//    - 每个请求须带请求头 `Authorization: Bearer <token>`，否则 401。令牌只走请求头，不进 URL。
//    - 带 Origin 的请求，其来源须在引擎的允许列表内，否则 403；Host 须为回环地址，否则 403。
//    - 渲染进程代码不持有令牌：Electron 下由主进程在网络层附加，纯 Web 开发模式由 Vite 代理附加。
//
//  POST /tasks               body: TaskParams | BatchSubmit   -> SubmitResult
//  GET  /tasks                                                -> Task[]
//  GET  /tasks/:id                                            -> Task
//  GET  /tasks/:id/frames                                     -> Frame[]  (逐秒全集，供换图)
//  GET  /tasks/:id/grids                                      -> GridList (03_grids 文件名清单，供半自动回填取图)
//  POST /tasks/:id/swap      body: SwapImageRequest           -> Task
//  POST /tasks/:id/article   body: Article (半自动回填)        -> Task
//  POST /tasks/:id/export    body: ExportRequest              -> ExportResult
//                            (awaiting_review / completed 均可调；省略 formats = 导出全部格式；非法格式 -> 400)
//  POST /tasks/:id/reopen                                     -> Task   (completed/failed → awaiting_review，返回校对；清 error)
//  POST /tasks/:id/cancel                                     -> Task
//
//  --- 模型服务设置（M7；任何响应都绝不含 Key 明文）---
//  GET  /settings/ai                                          -> AISettings        (baseUrl/model/imageSource + hasApiKey/keySource/ready/keyedBaseUrls)
//  POST /settings/ai         body: AISettingsPatch            -> AISettings        (保存地址/模型/喂图策略；地址会规范化；非法值 -> 400)
//  PUT  /settings/ai/key     body: AIKeyUpdate                -> AISettings        (只写：写入/清除某地址的 Key，apiKey=null 为清除；
//                                                                                   Key 不会被任何路由返回；非法地址或 body 形状 -> 400)
//  POST /settings/ai/test    (无 body)                        -> AITestResult      (用当前已保存的配置两步测试：连通性 + 看图/结构化级别；
//                                                                                   失败写进 error 而非 HTTP 错误；探测到的级别会被记住)
//
//  --- 静态资源（给浏览器看图；引擎按任务 workDir 内取，含路径穿越防护）---
//  GET  /static/:id/grids/:file   -> image/jpeg   宫格图字节（03_grids/<file>）
//  GET  /static/:id/hd/:file      -> image/jpeg   逐秒 HD 单帧（01_hd/<HH_MM_SS>.jpg，配图预览/后续换图）
//
//  --- 事件流 ---
//  GET  /events                   -> text/event-stream   SSE 全局事件流，逐条推送 EngineEvent
//
//  半自动(semi)说明：EngineEvent.awaiting_review 携带的 article 是 auto 模式的 Gemini 草稿；
//  semi 模式在 M6(grids) 完成后【没有 article】，引擎改发 status_changed → "awaiting_review"。
//  UI 据 GET /tasks/:id 发现 article 为空且 params.mode==="semi" 时，展示宫格图 + 文章 JSON 回填框。
//

export interface SubmitResult {
	ids: TaskId[];
}

/** GET /tasks/:id/grids 返回：03_grids 下的宫格图文件名（不含路径，按序）。 */
export interface GridList {
	/** 文件名如 "grid_001.jpg"，经 GET /static/:id/grids/:file 取字节。 */
	files: string[];
}

export interface SwapImageRequest {
	/** 第几页（ArticlePage 在 pages 中的索引）。 */
	pageIndex: number;
	/** 换成哪一帧的时间戳。 */
	image: Timestamp;
}

export interface ExportRequest {
	/** 要导出的格式；省略 = 全部（EXPORT_FORMATS）。 */
	formats?: ExportFormat[];
}

export interface ExportResult {
	/** 本次导出的各格式主产物路径。 */
	outputs: ExportOutputs;
	/** 非致命问题（如某页配图缺失已跳过）。 */
	warnings: string[];
}

// ============================================================
// WebSocket / SSE 事件（引擎 → UI 推送）
// ============================================================

export type EngineEvent =
	| { type: "task_created"; task: Task }
	| { type: "status_changed"; taskId: TaskId; status: TaskStatus }
	// M2 拿到视频信息（建好任务目录）后立即推送，让 UI 实时更新标题/workDir，无需等下一次交互。
	| { type: "info"; taskId: TaskId; videoTitle: string; workDir: string }
	| { type: "progress"; taskId: TaskId; progress: StepProgress }
	| { type: "awaiting_review"; taskId: TaskId; article: Article }
	| { type: "completed"; taskId: TaskId; outputs: ExportOutputs }
	| { type: "failed"; taskId: TaskId; error: string }
	| { type: "task_deleted"; taskId: TaskId };

// ============================================================
// UI 偏好设置（持久化到引擎 SQLite —— 铁律 #9：不用浏览器存储）
// ============================================================

export type ThemeMode = "auto" | "light" | "dark";

export interface UISettings {
	theme: ThemeMode;
	/** 自动刷新 cookie 时从哪个浏览器导出登录态。 */
	cookieBrowser: CookieBrowser;
}

export const UI_DEFAULTS: UISettings = {
	theme: "auto",
	cookieBrowser: "chrome",
};

/**
 * AI（全自动 M7）设置：模型服务地址 / 模型 / 喂图策略，以及当前地址 Key 的"状态"。
 * 【铁律 #6】API Key 只在引擎内存里（按地址绑定的 Key 表），
 * 绝不出现在本结构里、绝不回传渲染进程明文——这里只暴露"是否有 Key、来自哪里"。
 */
export interface AISettings {
	/** 模型服务地址（已规范化）。 */
	baseUrl: string;
	/** 生成所用模型。 */
	model: AIModel;
	/** 喂图策略（见 AIImageSource）。 */
	imageSource: AIImageSource;
	/** 当前地址是否有 Key（只读探测，绝不回传明文）。 */
	hasApiKey: boolean;
	/** 当前地址 Key 的来源。 */
	keySource: AIKeySource;
	/** 是否可发起请求：有 Key，或当前地址是回环地址（本机服务可不要 Key）。 */
	ready: boolean;
	/** 所有已有 Key 的地址（含来自环境变量的）。 */
	keyedBaseUrls: string[];
}

export const AI_DEFAULTS: Pick<AISettings, "baseUrl" | "model" | "imageSource"> = {
	baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
	model: "gemini-2.5-flash",
	imageSource: "grids",
};

/** 默认提示词模板（只读）。用于建任务时展示/编辑；含 {{videoTitle}}/{{imageCount}} 占位。 */
export interface PromptTemplateInfo {
	/** 引擎当前默认提示词模板全文。 */
	template: string;
}

// ============================================================
// 默认值（建议常量，前后端共用，避免魔法数）
// ============================================================

export const DEFAULTS = {
	quality: 1080 as VideoQuality,
	dedup: true,
	/** phash 去重默认阈值（64 位汉明距离）；需按真实素材校准。 */
	dedupThreshold: 15,
	mode: "auto" as ArticleMode,
	/** 限流：单批最大任务数。 */
	maxBatchSize: 10,
	/** 限流：批次间最小间隔（毫秒），约 2 小时。 */
	minBatchIntervalMs: 2 * 60 * 60 * 1000,
	/** 宫格图布局：列 × 行。 */
	gridCols: 10,
	gridRows: 5,
} as const;
