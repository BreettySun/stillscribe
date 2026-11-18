/**
 * 本地 HTTP 服务（Fastify，绑定 127.0.0.1）。所有请求须过鉴权（令牌 + 来源 + Host，见 auth.ts）。
 * 按 shared/types.ts 的 HTTP 契约实现，
 * 进度/状态经 SSE(GET /events) 实时回传。渲染进程通过 localhost HTTP 访问（CLAUDE.md 铁律 #8）。
 *
 * 业务编排在 Orchestrator；本文件只做请求解析、校验、产物取图（含路径穿越防护）与 SSE 桥接。
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import {
	DEFAULTS,
	EXPORT_FORMATS,
	type AIKeyUpdate,
	type AISettings,
	type AISettingsPatch,
	type BatchSubmit,
	type CookieBrowser,
	type ExportFormat,
	type ExportRequest,
	type ExportResult,
	type Frame,
	type GridList,
	type PromptTemplateInfo,
	type SubmitResult,
	type SwapImageRequest,
	type TaskParams,
	type ThemeMode,
	type UISettings,
	UI_DEFAULTS,
} from "@shared/types";
import { TaskDir, matchFiles } from "./paths.ts";
import { isLoopbackHost, parseBearer, tokenMatches, type AuthConfig } from "./auth.ts";
import { loadManifest } from "./modules/m5-select.ts";
import { refreshCookies } from "./modules/cookies-refresh.ts";
import { validateArticle } from "./validate.ts";
import { AIConfigError, type AIConfig } from "./modules/m7/aiConfig.ts";
import { loadPromptTemplate } from "./modules/m7/prompt.ts";
import type { TaskStore } from "./store/tasks.ts";
import type { SettingsStore } from "./store/settings.ts";
import type { EventBus } from "./orchestrator/events.ts";
import type { Orchestrator } from "./orchestrator/queue.ts";

export interface ServerDeps {
	store: TaskStore;
	bus: EventBus;
	orchestrator: Orchestrator;
	settings: SettingsStore;
	/** 工作根目录，用于 cookie 刷新落盘 <workRoot>/cookies.txt。 */
	workRoot: string;
	/** 接口鉴权配置（必填：没有"不鉴权"的运行方式）。 */
	auth: AuthConfig;
	/** 模型服务配置（地址/模型/Key 表）。 */
	ai: AIConfig;
}

const THEME_MODES: readonly ThemeMode[] = ["auto", "light", "dark"];

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** AIConfigError 的消息只含地址/字段说明，不含 Key，可直接回给调用方；其他异常原样抛出 */
function asHttpError(e: unknown): unknown {
	return e instanceof AIConfigError ? new HttpError(400, e.message) : e;
}

class HttpError extends Error {
	constructor(
		readonly statusCode: number,
		message: string,
	) {
		super(message);
	}
}

const COOKIE_BROWSERS: readonly CookieBrowser[] = [
	"safari",
	"chrome",
	"edge",
	"firefox",
	"opera",
];

/** 自定义提示词全文上限（防滥用）。 */
const PROMPT_OVERRIDE_MAX = 50_000;

/** 规整可选的 promptOverride：非字符串/空白 → 不带该字段；超长抛 400。 */
function normalizePromptOverride(x: unknown): { promptOverride?: string } {
	if (typeof x !== "string") return {};
	const v = x.trim();
	if (!v) return {};
	if (v.length > PROMPT_OVERRIDE_MAX) {
		throw new HttpError(400, `promptOverride 过长（> ${PROMPT_OVERRIDE_MAX} 字符）`);
	}
	return { promptOverride: v };
}

/** 把不可信输入规整成 TaskParams 并填默认值；url 缺失抛 400，browser 非法抛 400。 */
function normalizeParams(x: unknown): TaskParams {
	const o = (x ?? {}) as Record<string, unknown>;
	if (typeof o.url !== "string" || !o.url.trim()) {
		throw new HttpError(400, "缺少 url");
	}
	if (
		o.browser !== undefined &&
		!COOKIE_BROWSERS.includes(o.browser as CookieBrowser)
	) {
		throw new HttpError(400, `不支持的 browser: ${String(o.browser)}`);
	}
	return {
		url: o.url.trim(),
		quality: o.quality === 1440 ? 1440 : DEFAULTS.quality,
		dedup: typeof o.dedup === "boolean" ? o.dedup : DEFAULTS.dedup,
		...(typeof o.dedupThreshold === "number"
			? { dedupThreshold: o.dedupThreshold }
			: {}),
		mode: o.mode === "auto" ? "auto" : DEFAULTS.mode,
		...(o.browser !== undefined ? { browser: o.browser as CookieBrowser } : {}),
		...(typeof o.promptTemplateId === "string"
			? { promptTemplateId: o.promptTemplateId }
			: {}),
		...normalizePromptOverride(o.promptOverride),
		makeClips: o.makeClips === true,
	};
}

/** 规整导出格式：省略 → 全部；必须是非空的合法格式数组（去重），否则抛 400。 */
export function normalizeFormats(x: unknown): ExportFormat[] {
	if (x === undefined || x === null) return [...EXPORT_FORMATS];
	if (!Array.isArray(x) || x.length === 0) {
		throw new HttpError(400, "formats 必须是非空数组");
	}
	for (const f of x) {
		if (!EXPORT_FORMATS.includes(f as ExportFormat)) {
			throw new HttpError(400, `不支持的导出格式: ${String(f)}`);
		}
	}
	return [...new Set(x as ExportFormat[])];
}

/** 仅允许 dir 下的直接子文件，杜绝路径穿越（含 "..", 分隔符, NUL）；越界返回 null。 */
export function resolveWithin(dir: string, file: string): string | null {
	if (!file || file === "." || file === "..") return null;
	if (file.includes("/") || file.includes("\\") || file.includes("\0"))
		return null;
	const base = path.resolve(dir);
	const resolved = path.resolve(base, file);
	// 必须恰好是 base 的直接子节点（dirname 严格等于 base）。
	if (path.dirname(resolved) !== base) return null;
	return resolved;
}

async function listByExt(dir: string, ext: string): Promise<string[]> {
	return matchFiles(dir, `*${ext}`);
}

/** 由 workDir 构造逐秒帧列表（供换图画廊）。 */
async function listFrames(workDir: string): Promise<Frame[]> {
	const td = new TaskDir(workDir);
	const hdFiles = await listByExt(td.hd, ".jpg");
	let repSet = new Set<string>();
	try {
		repSet = new Set(await loadManifest(td.representativesJson));
	} catch {
		/* 无 manifest（未去重/未跑到 M5）→ 全部非代表帧 */
	}
	return hdFiles.map((f) => {
		const ts = f.slice(0, -".jpg".length);
		return {
			timestamp: ts,
			hdPath: path.join(td.hd, f),
			webpPath: path.join(td.webp, `${ts}.webp`),
			isRepresentative: repSet.has(ts),
		};
	});
}

export function buildServer(deps: ServerDeps): FastifyInstance {
	const { store, bus, orchestrator, settings, workRoot, auth, ai } = deps;
	const app = Fastify({ logger: false });
	const allowedOrigins = new Set(auth.allowedOrigins);

	// CORS：只对允许列表里的来源回 Access-Control-Allow-Origin（其余来源浏览器读不到响应）。
	// 先于鉴权钩子注册——预检(OPTIONS)由它直接应答；鉴权失败的响应也带得上 CORS 头，便于排查。
	app.register(cors, {
		origin: (origin, cb) => cb(null, origin !== undefined && allowedOrigins.has(origin)),
	});

	// 鉴权（每个请求都过，含静态取图与 SSE）：Host → 来源 → 令牌。说明见 auth.ts。
	app.addHook("onRequest", async (req, reply) => {
		if (!isLoopbackHost(req.headers.host)) {
			return reply.code(403).send({ error: "拒绝访问：Host 不是本机回环地址" });
		}
		const origin = req.headers.origin;
		if (origin !== undefined && !allowedOrigins.has(origin)) {
			return reply.code(403).send({ error: "拒绝访问：请求来源不在允许列表" });
		}
		if (req.method === "OPTIONS") return; // CORS 预检按规范不带凭证
		if (!tokenMatches(auth.token, parseBearer(req.headers.authorization))) {
			return reply.code(401).send({ error: "未授权：缺少或错误的接口令牌" });
		}
	});

	const taskOr404 = (id: string) => {
		const t = store.get(id);
		if (!t) throw new HttpError(404, `任务不存在: ${id}`);
		return t;
	};

	app.setErrorHandler((err: unknown, _req, reply) => {
		const status = err instanceof HttpError ? err.statusCode : 400;
		const message = err instanceof Error ? err.message : String(err);
		reply.code(status).send({ error: message });
	});

	// ---- 任务 ----
	app.post("/tasks", (req): SubmitResult => {
		const body = req.body as BatchSubmit | TaskParams | undefined;
		const rawList =
			body && Array.isArray((body as BatchSubmit).tasks)
				? (body as BatchSubmit).tasks
				: [body];
		if (rawList.length === 0) throw new HttpError(400, "空提交");
		if (rawList.length > DEFAULTS.maxBatchSize) {
			throw new HttpError(400, `单批最多 ${DEFAULTS.maxBatchSize} 个任务`);
		}
		const params = rawList.map(normalizeParams);
		const ids = params.map((p) => orchestrator.submit(p).id);
		return { ids };
	});

	app.get("/tasks", () => store.list());

	app.get("/tasks/:id", (req) => taskOr404((req.params as { id: string }).id));

	app.get("/tasks/:id/frames", async (req): Promise<Frame[]> => {
		const task = taskOr404((req.params as { id: string }).id);
		if (!task.workDir) return [];
		return listFrames(task.workDir);
	});

	app.get("/tasks/:id/grids", async (req): Promise<GridList> => {
		const task = taskOr404((req.params as { id: string }).id);
		if (!task.workDir) return { files: [] };
		return { files: await listByExt(new TaskDir(task.workDir).grids, ".jpg") };
	});

	app.post("/tasks/:id/swap", (req) => {
		const id = (req.params as { id: string }).id;
		taskOr404(id);
		const reqBody = req.body as SwapImageRequest;
		if (
			typeof reqBody?.pageIndex !== "number" ||
			typeof reqBody?.image !== "string"
		) {
			throw new HttpError(400, "swap 需要 { pageIndex:number, image:string }");
		}
		return orchestrator.swap(id, reqBody);
	});

	app.post("/tasks/:id/article", (req) => {
		const id = (req.params as { id: string }).id;
		taskOr404(id);
		const article = validateArticle(req.body); // 形状不对会抛错 → 400
		return orchestrator.setArticle(id, article);
	});

	app.post("/tasks/:id/export", async (req): Promise<ExportResult> => {
		const id = (req.params as { id: string }).id;
		taskOr404(id);
		const body = (req.body ?? {}) as ExportRequest;
		return orchestrator.exportArticle(id, normalizeFormats(body.formats));
	});

	// 返回上一步：completed/failed → awaiting_review（保留 article，清 error）。
	app.post("/tasks/:id/reopen", (req) => {
		const id = (req.params as { id: string }).id;
		taskOr404(id);
		return orchestrator.reopenReview(id);
	});

	app.post("/tasks/:id/cancel", (req) =>
		orchestrator.cancel((req.params as { id: string }).id),
	);

	app.delete("/tasks/:id", (req): { ok: true } => {
		const id = (req.params as { id: string }).id;
		taskOr404(id);
		orchestrator.remove(id);
		return { ok: true };
	});

	app.post("/tasks/:id/retry", (req) =>
		orchestrator.retry((req.params as { id: string }).id),
	);

	// ---- Cookie 刷新（从浏览器导出 youtube.com cookie 到 <workRoot>/cookies.txt）----
	app.post("/cookies/refresh", async (req): Promise<{ kept: number }> => {
		const body = (req.body ?? {}) as { browser?: CookieBrowser };
		const browser = body.browser ?? readUISettings().cookieBrowser;
		if (!COOKIE_BROWSERS.includes(browser))
			throw new HttpError(400, `非法 browser: ${browser}`);
		try {
			const { kept } = await refreshCookies({ workRoot, browser });
			return { kept };
		} catch (err) {
			throw new HttpError(
				500,
				err instanceof Error ? err.message : String(err),
			);
		}
	});

	// ---- UI 偏好设置（持久化到 SQLite，跨刷新/重启保留）----
	const readUISettings = (): UISettings => {
		const theme = settings.get("theme");
		const cookieBrowser = settings.get("cookieBrowser");
		return {
			theme: THEME_MODES.includes(theme as ThemeMode)
				? (theme as ThemeMode)
				: UI_DEFAULTS.theme,
			cookieBrowser: COOKIE_BROWSERS.includes(cookieBrowser as CookieBrowser)
				? (cookieBrowser as CookieBrowser)
				: UI_DEFAULTS.cookieBrowser,
		};
	};

	app.get("/settings", (): UISettings => readUISettings());

	app.post("/settings", (req): UISettings => {
		const body = (req.body ?? {}) as Partial<UISettings>;
		if (body.theme !== undefined) {
			if (!THEME_MODES.includes(body.theme))
				throw new HttpError(400, `非法 theme: ${body.theme}`);
			settings.set("theme", body.theme);
		}
		if (body.cookieBrowser !== undefined) {
			if (!COOKIE_BROWSERS.includes(body.cookieBrowser)) {
				throw new HttpError(400, `非法 cookieBrowser: ${body.cookieBrowser}`);
			}
			settings.set("cookieBrowser", body.cookieBrowser);
		}
		return readUISettings();
	});

	// ---- 模型服务设置（M7）。三条路由：GET 读取、POST 保存地址/模型/喂图策略、
	//       PUT /settings/ai/key 写入或清除某地址的 Key（只写：任何响应都不含 Key，铁律 #6）。
	//       body 形状先在此校验，值的合法性（地址规范化等）由 AIConfig 判定，错误一律 400 ----
	app.get("/settings/ai", () => ai.read());

	app.post("/settings/ai", (req): AISettings => {
		const body = req.body;
		if (!isPlainObject(body)) throw new HttpError(400, "请求体必须是 JSON 对象");
		const patch: Record<string, string> = {};
		for (const k of ["baseUrl", "model", "imageSource"]) {
			if (body[k] === undefined) continue;
			if (typeof body[k] !== "string") throw new HttpError(400, `${k} 必须是字符串`);
			patch[k] = body[k];
		}
		try {
			return ai.save(patch as AISettingsPatch);
		} catch (e) {
			throw asHttpError(e);
		}
	});

	app.put("/settings/ai/key", (req): AISettings => {
		const body = req.body;
		if (!isPlainObject(body)) throw new HttpError(400, "请求体必须是 JSON 对象");
		if (typeof body.baseUrl !== "string") throw new HttpError(400, "baseUrl 必须是字符串");
		if (body.apiKey !== null && typeof body.apiKey !== "string") {
			throw new HttpError(400, "apiKey 必须是字符串或 null");
		}
		const update: AIKeyUpdate = { baseUrl: body.baseUrl, apiKey: body.apiKey };
		try {
			return ai.setKey(update);
		} catch (e) {
			throw asHttpError(e);
		}
	});

	// ---- 默认提示词模板（只读）：供建任务时展示/编辑；含 {{videoTitle}}/{{imageCount}} 占位 ----
	app.get(
		"/settings/prompt",
		async (): Promise<PromptTemplateInfo> => ({ template: await loadPromptTemplate() }),
	);

	// ---- 静态产物（含路径穿越防护）----
	const sendImage = async (
		reply: import("fastify").FastifyReply,
		dir: string,
		file: string,
	) => {
		const resolved = resolveWithin(dir, file);
		if (!resolved) return reply.code(400).send({ error: "非法文件名" });
		try {
			await stat(resolved);
		} catch {
			return reply.code(404).send({ error: "文件不存在" });
		}
		reply.type("image/jpeg");
		return reply.send(createReadStream(resolved));
	};

	app.get("/static/:id/grids/:file", (req, reply) => {
		const { id, file } = req.params as { id: string; file: string };
		const task = taskOr404(id);
		return sendImage(reply, new TaskDir(task.workDir).grids, file);
	});

	app.get("/static/:id/hd/:file", (req, reply) => {
		const { id, file } = req.params as { id: string; file: string };
		const task = taskOr404(id);
		return sendImage(reply, new TaskDir(task.workDir).hd, file);
	});

	// ---- SSE 事件流 ----
	app.get("/events", (req, reply) => {
		// hijack 直写 socket 会绕过 @fastify/cors，需手动补 CORS 头。走到这里的请求已过鉴权钩子，
		// 带 Origin 的必在允许列表内，原样回写即可。
		// 否则桌面 App 渲染进程跨源（localhost:5173 → 127.0.0.1:port）订阅 SSE 会被浏览器拦截。
		const origin = req.headers.origin;
		reply.raw.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			...(origin
				? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
				: {}),
		});
		reply.raw.write(": connected\n\n");
		const unsub = bus.subscribe((e) => {
			reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
		});
		const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
		req.raw.on("close", () => {
			clearInterval(heartbeat);
			unsub();
		});
		reply.hijack(); // 接管底层响应，Fastify 不再尝试结束它
	});

	return app;
}
