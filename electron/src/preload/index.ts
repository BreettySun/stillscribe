/**
 * preload：唯一的渲染进程↔主进程桥（contextIsolation 下用 contextBridge）。
 * 暴露引擎源地址（渲染进程据此走 localhost HTTP 直连引擎）+ 少量 OS 能力。
 */
import { contextBridge, ipcRenderer } from "electron";

function originFromArgv(): string {
	const prefix = "--diggo-origin=";
	const arg = process.argv.find((a) => a.startsWith(prefix));
	return arg ? arg.slice(prefix.length) : "";
}

contextBridge.exposeInMainWorld("diggo", {
	/** 引擎 HTTP 源，如 http://127.0.0.1:51234。 */
	engineOrigin: originFromArgv(),
	platform: process.platform,
	/** 在访达中定位文件。 */
	revealInFolder: (p: string): Promise<void> =>
		ipcRenderer.invoke("diggo:reveal", p),
	/** 系统通知。 */
	notify: (title: string, body: string): void =>
		ipcRenderer.send("diggo:notify", { title, body }),
});
