"use strict";
const node_child_process = require("node:child_process");
const node_net = require("node:net");
const path = require("node:path");
const electron = require("electron");
const REPO_ROOT = path.resolve(__dirname, "../../..");
let engine = null;
let enginePort = 0;
let quitting = false;
let restarts = 0;
const MAX_RESTARTS = 5;
function getFreePort() {
  return new Promise((res, rej) => {
    const srv = node_net.createServer();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => port ? res(port) : rej(new Error("无法获取空闲端口")));
    });
  });
}
function startEngine(workRoot) {
  const env = {
    ...process.env,
    DIGGO_HOST: "127.0.0.1",
    DIGGO_PORT: String(enginePort),
    DIGGO_WORK_ROOT: workRoot
  };
  engine = node_child_process.spawn("pnpm", ["--filter", "@diggo/engine", "serve"], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "inherit", "inherit"]
  });
  engine.on("exit", (code, signal) => {
    engine = null;
    if (quitting) return;
    if (restarts >= MAX_RESTARTS) {
      console.error(`引擎已崩溃 ${restarts} 次，停止自动重启。`);
      return;
    }
    restarts++;
    const delay = Math.min(1e3 * restarts, 5e3);
    console.error(
      `引擎退出 (code=${code}, signal=${signal})，${delay}ms 后第 ${restarts} 次重启…`
    );
    setTimeout(() => startEngine(workRoot), delay);
  });
}
async function waitHealthy(origin, timeoutMs = 15e3) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${origin}/tasks`);
      if (r.ok) return true;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
function createWindow(origin) {
  const win = new electron.BrowserWindow({
    width: 1200,
    height: 820,
    show: false,
    title: "diggo-press",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--diggo-origin=${origin}`]
    }
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
function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...isMac ? [{ role: "appMenu" }] : [],
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
        { role: "togglefullscreen" }
      ]
    },
    { role: "windowMenu" }
  ];
  electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template));
}
electron.ipcMain.handle("diggo:reveal", (_e, p) => {
  if (typeof p === "string" && p) electron.shell.showItemInFolder(p);
});
electron.ipcMain.on("diggo:notify", (_e, payload) => {
  if (!electron.Notification.isSupported()) return;
  new electron.Notification({
    title: payload?.title ?? "diggo-press",
    body: payload?.body ?? ""
  }).show();
});
electron.app.whenReady().then(async () => {
  enginePort = await getFreePort();
  const origin = `http://127.0.0.1:${enginePort}`;
  const workRoot = process.env.DIGGO_WORK_ROOT ?? path.join(REPO_ROOT, "engine", "work");
  startEngine(workRoot);
  await waitHealthy(origin);
  buildMenu();
  createWindow(origin);
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow(origin);
  });
});
electron.app.on("before-quit", () => {
  quitting = true;
  engine?.kill("SIGTERM");
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
