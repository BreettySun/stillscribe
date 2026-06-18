/**
 * Electron 主进程：spawn/监督引擎子进程 + 创建窗口 + OS 集成（菜单/Finder/通知）。
 * 渲染进程通过 localhost HTTP 访问引擎，不用 IPC 直连引擎（CLAUDE.md 铁律 #8）；
 * IPC 仅用于 OS 能力（reveal/notify）。
 */
import { spawn, type ChildProcess } from "node:child_process";
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
	shell,
} from "electron";
import { filterYouTube } from "@engine/modules/cookies-filter";

// 运行时 __dirname = electron/out/main → 上溯三级到仓库根。
const REPO_ROOT = path.resolve(__dirname, "../../..");

// 包名是 @diggo/desktop，会让 userData 落到 "Application Support/@diggo/desktop"（难看且含斜杠）。
// 统一显示名，使 userData = "Application Support/diggo-press"。必须在 app ready 前调用。
app.setName("diggo-press");

/**
 * 工作根（与引擎一致）：可被 DIGGO_WORK_ROOT 覆盖。
 * - 打包后：app.getPath("userData")/work（仓库目录不存在/不可写）。
 * - 开发态：仓库 engine/work（与 `pnpm dev:engine` 共用同一个 tasks.db，队列互通）。
 */
function getWorkRoot(): string {
	if (process.env.DIGGO_WORK_ROOT) return process.env.DIGGO_WORK_ROOT;
	if (app.isPackaged) return path.join(app.getPath("userData"), "work");
	return path.join(REPO_ROOT, "engine", "work");
}

/** 内置二进制目录：打包后 process.resourcesPath/bin，开发态仓库 bin/。 */
function binDir(): string {
	return app.isPackaged ? path.join(process.resourcesPath, "bin") : path.join(REPO_ROOT, "bin");
}

/** yt-dlp 绝对路径（禁止依赖 PATH，铁律 #1）：env 覆盖 > 内置 bin/。 */
function ytDlpPath(): string {
	if (process.env.DIGGO_YT_DLP) return process.env.DIGGO_YT_DLP;
	return path.join(binDir(), "yt-dlp");
}

/** deno 绝对路径（yt-dlp 解 YouTube nsig 的 JS 运行时）：env 覆盖 > 内置 bin/。 */
function denoPath(): string {
	return process.env.DIGGO_DENO ?? path.join(binDir(), "deno");
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
		`diggo-cookies-${process.pid}-${Date.now()}.txt`,
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

let engine: ChildProcess | null = null;
let enginePort = 0;
let quitting = false;
let restarts = 0;
const MAX_RESTARTS = 5;

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
		DIGGO_HOST: "127.0.0.1",
		DIGGO_PORT: String(enginePort),
		DIGGO_WORK_ROOT: workRoot,
		// 引擎绝对路径找 CLI（铁律 #1）：env 优先，打包后指向 resources/bin，引擎保持 Electron-agnostic。
		DIGGO_YT_DLP: path.join(bin, "yt-dlp"),
		DIGGO_FFMPEG: path.join(bin, "ffmpeg"),
		DIGGO_FFPROBE: path.join(bin, "ffprobe"),
		DIGGO_DENO: path.join(bin, "deno"),
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
		engine = spawn("pnpm", ["--filter", "@diggo/engine", "serve"], {
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
			const r = await fetch(`${origin}/tasks`);
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
			additionalArguments: [`--diggo-origin=${origin}`],
		},
	});
	win.once("ready-to-show", () => win.show());

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

ipcMain.handle("diggo:reveal", (_e, p: unknown) => {
	if (typeof p === "string" && p) shell.showItemInFolder(p);
});

ipcMain.on("diggo:notify", (_e, payload: { title?: string; body?: string }) => {
	if (!Notification.isSupported()) return;
	new Notification({
		title: payload?.title ?? "diggo-press",
		body: payload?.body ?? "",
	}).show();
});

// 刷新 cookie：在主进程（可访问浏览器钥匙串、可弹系统授权框）执行，写入引擎 workRoot/cookies.txt。
ipcMain.handle("diggo:refresh-cookies", (_e, browser: unknown) =>
	refreshCookies(typeof browser === "string" && browser ? browser : "chrome"),
);

app.whenReady().then(async () => {
	// 开发期 Dock 图标（打包后由 electron-builder 的 build/icon.icns 接管，P4）。
	if (process.platform === "darwin" && !app.isPackaged) {
		app.dock?.setIcon(path.join(REPO_ROOT, "build", "icon.png"));
	}

	enginePort = await getFreePort();
	const origin = `http://127.0.0.1:${enginePort}`;
	// 开发态：与 `pnpm dev:engine` 共用 engine/work（同一个 tasks.db，队列互通）。
	// P4 打包后仓库目录不存在/不可写，届时改回 app.getPath("userData")。
	const workRoot = getWorkRoot();

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
