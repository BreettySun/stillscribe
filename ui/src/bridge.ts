/**
 * 平台桥：抹平 "Electron 套壳" 与 "纯 Web" 两种形态。
 * - Electron：window.diggo 由 preload 注入，引擎源为主进程分配的端口，并提供 OS 能力。
 * - 纯 Web（pnpm dev:ui）：window.diggo 不存在 → 引擎源回退到 /api（走 Vite 代理），OS 能力为空操作。
 */
const bridgeImpl = window.diggo;

/** 引擎 HTTP 源；Web 模式下为 "/api"（同源 + Vite 代理）。 */
export const engineOrigin: string = bridgeImpl?.engineOrigin || "/api";

/** 是否运行在 Electron 套壳内。 */
export const isDesktop: boolean = !!bridgeImpl;

export function revealInFolder(path: string): void {
  void bridgeImpl?.revealInFolder(path);
}

export function notify(title: string, body: string): void {
  bridgeImpl?.notify(title, body);
}
