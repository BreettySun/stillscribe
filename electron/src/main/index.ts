/**
 * Electron 主进程：spawn/监督引擎子进程 + 创建窗口 + OS 集成（菜单/Finder/通知）。
 * 渲染进程通过 localhost HTTP 访问引擎，不用 IPC 直连引擎（CLAUDE.md 铁律 #8）；
 * IPC 仅用于 OS 能力（reveal/notify）。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import {
	app,
	BrowserWindow,
	Menu,
	Notification,
	ipcMain,
	shell,
} from "electron";

// 运行时 __dirname = electron/out/main → 上溯三级到仓库根。
const REPO_ROOT = path.resolve(__dirname, "../../..");

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
	const env: NodeJS.ProcessEnv = {
		...process.env,
		DIGGO_HOST: "127.0.0.1",
		DIGGO_PORT: String(enginePort),
		DIGGO_WORK_ROOT: workRoot,
	};

	engine = spawn("pnpm", ["--filter", "@diggo/engine", "serve"], {
		cwd: REPO_ROOT,
		env,
		stdio: ["ignore", "inherit", "inherit"],
	});
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
		title: "diggo-press",
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

app.whenReady().then(async () => {
	enginePort = await getFreePort();
	const origin = `http://127.0.0.1:${enginePort}`;
	// 开发态：与 `pnpm dev:engine` 共用 engine/work（同一个 tasks.db，队列互通）。
	// P4 打包后仓库目录不存在/不可写，届时改回 app.getPath("userData")。
	const workRoot =
		process.env.DIGGO_WORK_ROOT ?? path.join(REPO_ROOT, "engine", "work");

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
