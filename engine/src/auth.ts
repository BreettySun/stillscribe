/**
 * 本地引擎 HTTP 接口的鉴权。
 *
 * 引擎只监听 127.0.0.1，但"只听本机"挡不住本机浏览器里的网页：任意网站的脚本都能向
 * http://127.0.0.1:<端口> 发请求。所以接口必须自带三道检查（见 server.ts 的 onRequest 钩子）：
 *
 *   1. 令牌：每个请求带 `Authorization: Bearer <token>`。令牌由启动引擎的一方持有——
 *      Electron 主进程每次启动随机生成，经 env 传给引擎，再在网络层给渲染进程的请求补上请求头
 *      （渲染进程自己拿不到令牌）。单独跑引擎（pnpm dev:engine）时引擎自己生成，
 *      写进 <workRoot>/engine-token（仅当前用户可读），由 Vite 开发代理读出后代为附加。
 *   2. 来源：请求带 Origin 时必须在允许列表里。浏览器发起的跨站写请求都会带 Origin，
 *      这一条用来挡"网页借开发代理代发请求"。
 *   3. Host：必须是回环地址，挡 DNS 重绑定。
 *
 * 【铁律 #6】令牌只走请求头，绝不进 URL / query；不写日志；令牌文件在工作根下（不进 git）。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { engineTokenPath } from "./paths.ts";

export interface AuthConfig {
	/** 接口令牌。 */
	token: string;
	/** 允许的请求来源（Origin 请求头的原值，如 "http://localhost:5173"；file:// 页面是字面量 "null"）。 */
	allowedOrigins: readonly string[];
}

/** 生成一个新令牌（256 位随机数，base64url）。 */
export function generateToken(): string {
	return randomBytes(32).toString("base64url");
}

/** 从 `Authorization: Bearer <token>` 取出令牌；格式不对返回 undefined。 */
export function parseBearer(header: string | undefined): string | undefined {
	if (!header) return undefined;
	const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
	return m?.[1];
}

/** 常数时间比较（先各自哈希成等长再比，避免长度与内容经时序泄露）。 */
export function tokenMatches(expected: string, presented: string | undefined): boolean {
	if (!presented) return false;
	const a = createHash("sha256").update(expected).digest();
	const b = createHash("sha256").update(presented).digest();
	return timingSafeEqual(a, b);
}

/** Host 请求头是否指向回环地址（127.0.0.1 / localhost / [::1]，端口不限）。 */
export function isLoopbackHost(host: string | undefined): boolean {
	if (!host) return false;
	const name = host.startsWith("[")
		? host.slice(0, host.indexOf("]") + 1)
		: (host.split(":")[0] ?? "");
	return ["127.0.0.1", "localhost", "[::1]"].includes(name.toLowerCase());
}

/** 解析逗号分隔的来源列表（env STILLSCRIBE_ALLOWED_ORIGINS）。 */
export function parseOrigins(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * 解析引擎进程的鉴权配置。
 * - 有 env STILLSCRIBE_TOKEN（由 Electron 主进程注入）：直接用，不落盘。
 * - 没有：自己生成一个，写入 <workRoot>/engine-token 供本机的开发代理读取。
 *   每次启动都换新，旧令牌随之失效。
 */
export function resolveAuth(workRoot: string, env: NodeJS.ProcessEnv = process.env): AuthConfig {
	const allowedOrigins = parseOrigins(env.STILLSCRIBE_ALLOWED_ORIGINS);
	const fromEnv = env.STILLSCRIBE_TOKEN?.trim();
	if (fromEnv) return { token: fromEnv, allowedOrigins };

	const token = generateToken();
	const file = engineTokenPath(workRoot);
	writeFileSync(file, `${token}\n`, { mode: 0o600 });
	chmodSync(file, 0o600); // 文件已存在时 mode 选项不生效，显式收紧
	return { token, allowedOrigins };
}
