"use strict";
const electron = require("electron");
function originFromArgv() {
	const prefix = "--diggo-origin=";
	const arg = process.argv.find((a) => a.startsWith(prefix));
	return arg ? arg.slice(prefix.length) : "";
}
electron.contextBridge.exposeInMainWorld("diggo", {
	/** 引擎 HTTP 源，如 http://127.0.0.1:51234。 */
	engineOrigin: originFromArgv(),
	platform: process.platform,
	/** 在访达中定位文件。 */
	revealInFolder: (p) => electron.ipcRenderer.invoke("diggo:reveal", p),
	/** 系统通知。 */
	notify: (title, body) =>
		electron.ipcRenderer.send("diggo:notify", { title, body }),
});
