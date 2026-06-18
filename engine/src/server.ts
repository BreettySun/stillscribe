/**
 * 本地 HTTP 服务（Fastify，绑定 127.0.0.1）。按 shared/types.ts 的 HTTP 契约实现，
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
	type BatchSubmit,
	type CookieBrowser,
	type ExportRequest,
	type Frame,
	type GridList,
	type SubmitResult,
	type SwapImageRequest,
	type TaskParams,
	type ThemeMode,
	type UISettings,
	UI_DEFAULTS,
} from "@shared/types";
import { TaskDir, matchFiles } from "./paths.ts";
import { loadManifest } from "./modules/m5-select.ts";
import { refreshCookies } from "./modules/cookies-refresh.ts";
import { validateArticle } from "./validate.ts";
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
}

const THEME_MODES: readonly ThemeMode[] = ["auto", "light", "dark"];

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
	"brave",
	"chromium",
	"opera",
	"vivaldi",
];

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
		makeClips: o.makeClips === true,
	};
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
	const { store, bus, orchestrator, settings, workRoot } = deps;
	const app = Fastify({ logger: false });

	app.register(cors, { origin: true }); // 本地开发：允许浏览器直连（生产走 Vite 代理同源）

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

	app.post("/tasks/:id/export", async (req) => {
		const id = (req.params as { id: string }).id;
		taskOr404(id);
		const body = (req.body ?? {}) as ExportRequest;
		if (body.target === "feishu") {
			throw new HttpError(501, "飞书导出二期再做，请用 target=local");
		}
		const { docxPath } = await orchestrator.exportDocx(id);
		return { docxPath };
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
		// hijack 直写 socket 会绕过 @fastify/cors，需手动补 CORS 头（与 origin:true 一致，反射来源）。
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
