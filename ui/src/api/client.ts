/**
 * 引擎 HTTP 客户端：所有请求走 /api 前缀（Vite 代理到本地引擎）。
 * DTO 全部来自 @shared/types（唯一契约，禁止影子结构 —— CLAUDE.md 铁律 #3）。
 */
import type {
	AISettings,
	Article,
	BatchSubmit,
	ExportResult,
	Frame,
	GridList,
	PromptTemplateInfo,
	SubmitResult,
	SwapImageRequest,
	Task,
	TaskParams,
	UISettings,
} from "@shared/types";
import { engineOrigin } from "../bridge";

const BASE = engineOrigin;
const JSON_HEADERS = { "content-type": "application/json" };

async function parse<T>(res: Response): Promise<T> {
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
	return (await res.json()) as T;
}

export const api = {
	listTasks: () => fetch(`${BASE}/tasks`).then(parse<Task[]>),
	getTask: (id: string) => fetch(`${BASE}/tasks/${id}`).then(parse<Task>),

	submit: (body: TaskParams | BatchSubmit) =>
		fetch(`${BASE}/tasks`, {
			method: "POST",
			headers: JSON_HEADERS,
			body: JSON.stringify(body),
		}).then(parse<SubmitResult>),

	cancel: (id: string) =>
		fetch(`${BASE}/tasks/${id}/cancel`, { method: "POST" }).then(parse<Task>),

	retry: (id: string) =>
		fetch(`${BASE}/tasks/${id}/retry`, { method: "POST" }).then(parse<Task>),

	remove: (id: string) =>
		fetch(`${BASE}/tasks/${id}`, { method: "DELETE" }).then(
			parse<{ ok: true }>,
		),

	saveArticle: (id: string, article: Article) =>
		fetch(`${BASE}/tasks/${id}/article`, {
			method: "POST",
			headers: JSON_HEADERS,
			body: JSON.stringify(article),
		}).then(parse<Task>),

	swap: (id: string, req: SwapImageRequest) =>
		fetch(`${BASE}/tasks/${id}/swap`, {
			method: "POST",
			headers: JSON_HEADERS,
			body: JSON.stringify(req),
		}).then(parse<Task>),

	exportDocx: (id: string) =>
		fetch(`${BASE}/tasks/${id}/export`, {
			method: "POST",
			headers: JSON_HEADERS,
			body: JSON.stringify({ target: "local" }),
		}).then(parse<ExportResult>),

	getSettings: () => fetch(`${BASE}/settings`).then(parse<UISettings>),
	saveSettings: (patch: Partial<UISettings>) =>
		fetch(`${BASE}/settings`, {
			method: "POST",
			headers: JSON_HEADERS,
			body: JSON.stringify(patch),
		}).then(parse<UISettings>),

	/** AI 全自动状态（只读）：hasApiKey + model + imageSource。model/Key 由引擎侧 engine/.env 配置。 */
	getAISettings: () => fetch(`${BASE}/settings/ai`).then(parse<AISettings>),

	/** 默认提示词模板（只读）：建任务时展示/可编辑的底稿。 */
	getPromptTemplate: () =>
		fetch(`${BASE}/settings/prompt`).then(parse<PromptTemplateInfo>),

	listGrids: (id: string) =>
		fetch(`${BASE}/tasks/${id}/grids`).then(parse<GridList>),
	listFrames: (id: string) =>
		fetch(`${BASE}/tasks/${id}/frames`).then(parse<Frame[]>),

	/** 宫格图字节 URL（<img :src>）。 */
	gridUrl: (id: string, file: string) => `${BASE}/static/${id}/grids/${file}`,
	/** 逐秒 HD 单帧 URL：传时间戳 HH_MM_SS。 */
	hdUrl: (id: string, timestamp: string) =>
		`${BASE}/static/${id}/hd/${timestamp}.jpg`,
};
