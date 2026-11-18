/**
 * 平台桥：抹平 "Electron 套壳" 与 "纯 Web" 两种形态。
 * - Electron：window.stillscribe 由 preload 注入，引擎源为主进程分配的端口，并提供 OS 能力。
 * - 纯 Web（pnpm dev:ui）：window.stillscribe 不存在 → 引擎源回退到 /api（走 Vite 代理），OS 能力为空操作。
 */
const bridgeImpl = window.stillscribe;

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

/**
 * 刷新 youtube cookie。
 * - 桌面端：走 Electron 主进程 IPC（可访问浏览器钥匙串）。
 * - 纯 Web：走引擎 HTTP 端点（Web 下引擎是普通终端进程，能读钥匙串）。
 * 用裸 fetch（而非 api/client）以避免与 api/client→bridge 的循环依赖。
 */
export async function refreshCookies(browser: string): Promise<{ kept: number }> {
  if (bridgeImpl) return bridgeImpl.refreshCookies(browser);
  const res = await fetch(`${engineOrigin}/cookies/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ browser }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as { kept: number };
}
