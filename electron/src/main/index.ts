/**
 * Electron 主进程：spawn/监督引擎子进程 + 创建窗口 + OS 集成（菜单/Finder/通知）。
 * 渲染进程通过 localhost HTTP 访问引擎，不用 IPC 直连引擎（CLAUDE.md 铁律 #8）；
 * IPC 仅用于 OS 能力（reveal/notify）。
 *
 * 引擎接口鉴权（engine/src/auth.ts）：主进程每次启动随机生成令牌，经 env 交给引擎，
 * 再在网络层给"发往引擎的请求"补上 Authorization 头。渲染进程代码不接触令牌。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { mkdirSync, existsSync } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	app,
	BrowserWindow,
	Menu,
	Notification,
	ipcMain,
	session,
	shell,
} from "electron";
import { filterYouTube } from "@engine/modules/cookies-filter";
import { normalizeBaseUrl, withKey, type AIKeyTable } from "@shared/ai";
import { loadKeyTable, saveKeyTable } from "./aiKeys";

// 运行时 __dirname = electron/out/main → 上溯三级到仓库根。
const REPO_ROOT = path.resolve(__dirname, "../../..");

// 包名是 @stillscribe/desktop，会让 userData 落到 "Application Support/@stillscribe/desktop"（难看且含斜杠）。
// 统一显示名，使 userData = "Application Support/stillscribe"。必须在 app ready 前调用。
app.setName("stillscribe");

/**
 * 工作根（与引擎一致）：可被 STILLSCRIBE_WORK_ROOT 覆盖。
 * - 打包后：app.getPath("userData")/work（仓库目录不存在/不可写）。
 * - 开发态：仓库 engine/work（与 `pnpm dev:engine` 共用同一个 tasks.db，队列互通）。
 */
function getWorkRoot(): string {
	if (process.env.STILLSCRIBE_WORK_ROOT) return process.env.STILLSCRIBE_WORK_ROOT;
	if (app.isPackaged) return path.join(app.getPath("userData"), "work");
	return path.join(REPO_ROOT, "engine", "work");
}

/** 内置二进制目录：打包后 process.resourcesPath/bin，开发态仓库 bin/。 */
function binDir(): string {
	return app.isPackaged ? path.join(process.resourcesPath, "bin") : path.join(REPO_ROOT, "bin");
}

/** yt-dlp 绝对路径（禁止依赖 PATH，铁律 #1）：env 覆盖 > 内置 bin/。 */
function ytDlpPath(): string {
	if (process.env.STILLSCRIBE_YT_DLP) return process.env.STILLSCRIBE_YT_DLP;
	return path.join(binDir(), "yt-dlp");
}

/** deno 绝对路径（yt-dlp 解 YouTube nsig 的 JS 运行时）：env 覆盖 > 内置 bin/。 */
function denoPath(): string {
	return process.env.STILLSCRIBE_DENO ?? path.join(binDir(), "deno");
}

/** yt-dlp 的 --js-runtimes 参数；deno 不存在时返回 []（降级）。 */
function jsRuntimeArgs(): string[] {
	const deno = denoPath();
	return existsSync(deno) ? ["--js-runtimes", `deno:${deno}`] : [];
}

/** spawn 到完成；非 0 退出码 reject（含 stderr 尾部）。 */
function runYtDlp(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(ytDlpPath(), args, {
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (d) => (stderr += d.toString()));
		child.on("error", (err) =>
			reject(new Error(`无法启动 yt-dlp: ${err.message}`)),
		);
		child.on("close", (code) => {
			if (code === 0) return resolve();
			const tail = stderr.trim().split("\n").slice(-15).join("\n");
			reject(new Error(`yt-dlp 退出码 ${code}\n${tail}`));
		});
	});
}

/**
 * 从浏览器导出 youtube.com cookie 到 <workRoot>/cookies.txt（主进程执行：可访问钥匙串并弹系统授权框）。
 * 只保留 youtube.com（filterYouTube），不落盘无关站点 cookie。
 */
async function refreshCookies(browser: string): Promise<{ kept: number }> {
	const workRoot = getWorkRoot();
	mkdirSync(workRoot, { recursive: true });
	const out = path.join(workRoot, "cookies.txt");
	const tmp = path.join(
		tmpdir(),
		`stillscribe-cookies-${process.pid}-${Date.now()}.txt`,
	);
	try {
		await runYtDlp([
			...jsRuntimeArgs(),
			"--cookies-from-browser",
			browser,
			"--cookies",
			tmp,
			"--skip-download",
			"--print",
			"%(id)s",
			"https://www.youtube.com/watch?v=jNQXAC9IVRw",
		]);
		const { out: filtered, kept } = filterYouTube(await readFile(tmp, "utf-8"));
		await writeFile(out, filtered, "utf-8");
		return { kept };
	} finally {
		await rm(tmp, { force: true });
	}
}

/** 本次启动的引擎接口令牌：只存在于主进程内存与引擎子进程的 env，不落盘、不进渲染进程。 */
const engineToken = randomBytes(32).toString("base64url");
const engineAuthHeader = `Bearer ${engineToken}`;

/**
 * 渲染进程页面的来源（引擎据此放行跨源请求）。
 * 开发态由 electron-vite 的 dev server 提供页面；打包后是 file:// 页面，其 Origin 请求头为字面量 "null"。
 */
function rendererOrigin(): string {
	const devUrl = process.env["ELECTRON_RENDERER_URL"];
	return devUrl ? new URL(devUrl).origin : "null";
}

/**
 * 给本窗口会话里所有发往引擎的请求（fetch / <img> / EventSource）补上令牌请求头。
 * 在网络层做：<img> 与 EventSource 无法自定义请求头，而令牌又不允许放进 URL（铁律 #6）。
 */
function attachEngineAuth(origin: string): void {
	session.defaultSession.webRequest.onBeforeSendHeaders(
		{ urls: [`${origin}/*`] },
		(details, callback) => {
			callback({
				requestHeaders: { ...details.requestHeaders, Authorization: engineAuthHeader },
			});
		},
	);
}

let engine: ChildProcess | null = null;
let enginePort = 0;
let quitting = false;
let restarts = 0;
const MAX_RESTARTS = 5;
// 模型服务 Key 表（规范化 Base URL → Key；safeStorage 解密，app ready 后加载；引擎重启时取当前值）。
let aiKeys: AIKeyTable = {};

/** 让系统分配一个空闲端口（避免与单独运行的引擎 8787 冲突）。 */
function getFreePort(): Promise<number> {
	return new Promise((res, rej) => {
		const srv = createServer();
		srv.on("error", rej);
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address();
			const port = typeof addr === "object" && addr ? addr.port : 0;
			srv.close(() => (port ? res(port) : rej(new Error("无法获取空闲端口"))));
		});
	});
}

/** spawn 引擎并监督：非主动退出则带退避重启（限次数）。 */
function startEngine(workRoot: string): void {
	// cookies.txt 不在此注入——引擎按任务即时探测 <workRoot>/cookies.txt（P1 方案 A）：
	// 跑完 refresh-cookies 无需重启 App 即生效，文件失效时自动回退 --cookies-from-browser。
	const bin = binDir();
	const env: NodeJS.ProcessEnv = {
		...process.env,
		STILLSCRIBE_HOST: "127.0.0.1",
		STILLSCRIBE_PORT: String(enginePort),
		STILLSCRIBE_WORK_ROOT: workRoot,
		// 接口鉴权：令牌 + 允许的页面来源（显式覆盖，不继承外部同名 env）。
		STILLSCRIBE_TOKEN: engineToken,
		STILLSCRIBE_ALLOWED_ORIGINS: rendererOrigin(),
		// 引擎绝对路径找 CLI（铁律 #1）：env 优先，打包后指向 resources/bin，引擎保持 Electron-agnostic。
		STILLSCRIBE_YT_DLP: path.join(bin, "yt-dlp"),
		STILLSCRIBE_FFMPEG: path.join(bin, "ffmpeg"),
		STILLSCRIBE_FFPROBE: path.join(bin, "ffprobe"),
		STILLSCRIBE_DENO: path.join(bin, "deno"),
		// 模型服务 Key 表（safeStorage 解密后经 env 注入；Key 不写日志）。
		STILLSCRIBE_AI_KEYS: JSON.stringify(aiKeys),
	};

	if (app.isPackaged) {
		// 打包后无 pnpm/tsx/源码：用 Electron 自带 Node 跑 esbuild 打好的引擎单文件。
		// __dirname = .../Resources/app(.asar)/out/main → 同级 out/engine/serve.cjs。
		const enginePath = path.join(__dirname, "../engine/serve.cjs");
		engine = spawn(process.execPath, [enginePath], {
			env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
			stdio: ["ignore", "inherit", "inherit"],
		});
	} else {
		engine = spawn("pnpm", ["--filter", "@stillscribe/engine", "serve"], {
			cwd: REPO_ROOT,
			env,
			stdio: ["ignore", "inherit", "inherit"],
		});
	}
	engine.on("exit", (code, signal) => {
		engine = null;
		if (quitting) return;
		if (restarts >= MAX_RESTARTS) {
			console.error(`引擎已崩溃 ${restarts} 次，停止自动重启。`);
			return;
		}
		restarts++;
		const delay = Math.min(1000 * restarts, 5000);
		console.error(
			`引擎退出 (code=${code}, signal=${signal})，${delay}ms 后第 ${restarts} 次重启…`,
		);
		setTimeout(() => startEngine(workRoot), delay);
	});
}

/** 轮询 GET /tasks 直到引擎就绪（超时兜底，不阻塞窗口）。 */
async function waitHealthy(
	origin: string,
	timeoutMs = 15_000,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const r = await fetch(`${origin}/tasks`, {
				headers: { Authorization: engineAuthHeader },
			});
			if (r.ok) return true;
		} catch {
			/* 尚未起来 */
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	return false;
}

function createWindow(origin: string): BrowserWindow {
	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		show: false,
		title: "",
		webPreferences: {
			preload: path.join(__dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			additionalArguments: [`--stillscribe-origin=${origin}`],
		},
	});
	win.once("ready-to-show", () => win.show());

	// 外链（target="_blank"）一律交给系统默认浏览器，不在 App 内新开 Electron 窗口。
	// 默认 setWindowOpenHandler 行为是新建原生窗口，这里改为 deny + shell.openExternal。
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
		return { action: "deny" };
	});

	const devUrl = process.env["ELECTRON_RENDERER_URL"];
	if (devUrl) {
		void win.loadURL(devUrl);
	} else {
		void win.loadFile(path.join(__dirname, "../renderer/index.html"));
	}
	return win;
}

function buildMenu(): void {
	const isMac = process.platform === "darwin";
	const template: Electron.MenuItemConstructorOptions[] = [
		...(isMac ? [{ role: "appMenu" as const }] : []),
		{ role: "fileMenu" },
		{ role: "editMenu" },
		{
			label: "视图",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{ role: "windowMenu" },
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("stillscribe:reveal", (_e, p: unknown) => {
	if (typeof p === "string" && p) shell.showItemInFolder(p);
});

ipcMain.on("stillscribe:notify", (_e, payload: { title?: string; body?: string }) => {
	if (!Notification.isSupported()) return;
	new Notification({
		title: payload?.title ?? "StillScribe",
		body: payload?.body ?? "",
	}).show();
});

// 刷新 cookie：在主进程（可访问浏览器钥匙串、可弹系统授权框）执行，写入引擎 workRoot/cookies.txt。
ipcMain.handle("stillscribe:refresh-cookies", (_e, browser: unknown) =>
	refreshCookies(typeof browser === "string" && browser ? browser : "chrome"),
);

// 保存/清除某个模型服务地址的 Key：更新内存表 → 加密落盘 → 同步给运行中的引擎。Key 不写日志、不进错误信息。
ipcMain.handle(
	"stillscribe:set-ai-key",
	async (_e, baseUrl: unknown, apiKey: unknown): Promise<{ persisted: boolean }> => {
		if (typeof baseUrl !== "string") throw new Error("baseUrl 必须是字符串");
		const norm = normalizeBaseUrl(baseUrl);
		if (!norm.ok) throw new Error(norm.error);
		let key: string | null;
		if (apiKey === null) key = null;
		else if (typeof apiKey === "string" && apiKey.trim()) key = apiKey.trim();
		else throw new Error("apiKey 必须是非空字符串，或用 null 清除");

		aiKeys = withKey(aiKeys, norm.baseUrl, key);
		const persisted = saveKeyTable(aiKeys);

		let status = 0;
		try {
			const r = await fetch(`http://127.0.0.1:${enginePort}/settings/ai/key`, {
				method: "PUT",
				headers: { Authorization: engineAuthHeader, "Content-Type": "application/json" },
				body: JSON.stringify({ baseUrl: norm.baseUrl, apiKey: key }),
			});
			status = r.status;
		} catch {
			throw new Error("无法连接引擎，Key 已保存，重启后生效");
		}
		if (status < 200 || status >= 300) {
			throw new Error(`引擎拒绝更新 Key（HTTP ${status}），重启后生效`);
		}
		return { persisted };
	},
);

app.whenReady().then(async () => {
	// 开发期 Dock 图标（打包后由 electron-builder 的 build/icon.icns 接管，P4）。
	if (process.platform === "darwin" && !app.isPackaged) {
		app.dock?.setIcon(path.join(REPO_ROOT, "build", "icon.png"));
	}

	// safeStorage 须 app ready 后用：加载 Key 表（并迁移旧 gemini-key 文件），spawn 引擎时经 env 注入。
	aiKeys = loadKeyTable();

	enginePort = await getFreePort();
	const origin = `http://127.0.0.1:${enginePort}`;
	// 开发态：与 `pnpm dev:engine` 共用 engine/work（同一个 tasks.db，队列互通）。
	// P4 打包后仓库目录不存在/不可写，届时改回 app.getPath("userData")。
	const workRoot = getWorkRoot();

	attachEngineAuth(origin); // 须在创建窗口之前：页面的第一个请求就要带令牌
	startEngine(workRoot);
	await waitHealthy(origin);

	buildMenu();
	createWindow(origin);

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow(origin);
	});
});

app.on("before-quit", () => {
	quitting = true;
	engine?.kill("SIGTERM");
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
