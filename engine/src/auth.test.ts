import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
	generateToken,
	isLoopbackHost,
	parseBearer,
	parseOrigins,
	resolveAuth,
	tokenMatches,
} from "./auth.ts";
import { engineTokenPath } from "./paths.ts";
import { buildServer } from "./server.ts";
import { TaskStore } from "./store/tasks.ts";
import { SettingsStore } from "./store/settings.ts";
import { EventBus } from "./orchestrator/events.ts";
import { Orchestrator } from "./orchestrator/queue.ts";

describe("令牌工具", () => {
	it("generateToken 每次不同且足够长", () => {
		const a = generateToken();
		expect(a).not.toBe(generateToken());
		expect(a.length).toBeGreaterThanOrEqual(43); // 32 字节的 base64url
	});

	it("parseBearer 只认 Bearer 格式", () => {
		expect(parseBearer("Bearer abc")).toBe("abc");
		expect(parseBearer("bearer   abc")).toBe("abc");
		expect(parseBearer("Basic abc")).toBeUndefined();
		expect(parseBearer("Bearer")).toBeUndefined();
		expect(parseBearer("Bearer a b")).toBeUndefined();
		expect(parseBearer(undefined)).toBeUndefined();
	});

	it("tokenMatches 仅完全相同才通过", () => {
		expect(tokenMatches("secret", "secret")).toBe(true);
		expect(tokenMatches("secret", "secret2")).toBe(false);
		expect(tokenMatches("secret", "")).toBe(false);
		expect(tokenMatches("secret", undefined)).toBe(false);
	});

	it("isLoopbackHost 只认回环地址（端口不限）", () => {
		for (const ok of ["127.0.0.1:8787", "localhost:5173", "LOCALHOST", "[::1]:8787"]) {
			expect(isLoopbackHost(ok)).toBe(true);
		}
		for (const bad of ["evil.com", "evil.com:8787", "127.0.0.1.evil.com", "192.168.1.5:8787", "", undefined]) {
			expect(isLoopbackHost(bad)).toBe(false);
		}
	});

	it("parseOrigins 拆逗号、去空白与空项", () => {
		expect(parseOrigins(" http://localhost:5173 , null ,")).toEqual(["http://localhost:5173", "null"]);
		expect(parseOrigins(undefined)).toEqual([]);
	});
});

describe("resolveAuth", () => {
	it("有 DIGGO_TOKEN：直接用，不写令牌文件", () => {
		const workRoot = mkdtempSync(path.join(tmpdir(), "diggo-auth-"));
		const auth = resolveAuth(workRoot, { DIGGO_TOKEN: "from-env", DIGGO_ALLOWED_ORIGINS: "null" });
		expect(auth).toEqual({ token: "from-env", allowedOrigins: ["null"] });
		expect(existsSync(engineTokenPath(workRoot))).toBe(false);
	});

	it("无 DIGGO_TOKEN：生成新令牌并写入仅本人可读的文件；每次启动都换新", () => {
		const workRoot = mkdtempSync(path.join(tmpdir(), "diggo-auth-"));
		const file = engineTokenPath(workRoot);
		writeFileSync(file, "stale\n", { mode: 0o644 }); // 上次运行的残留，且权限过宽

		const auth = resolveAuth(workRoot, {});
		expect(auth.allowedOrigins).toEqual([]);
		expect(readFileSync(file, "utf-8").trim()).toBe(auth.token);
		expect(auth.token).not.toBe("stale");
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(resolveAuth(workRoot, {}).token).not.toBe(auth.token);
	});
});

describe("HTTP 接口鉴权", () => {
	const TOKEN = "test-token";
	const ORIGIN = "http://localhost:5173";
	const AUTH = { authorization: `Bearer ${TOKEN}` };
	let app: FastifyInstance | undefined;

	function server(): FastifyInstance {
		const store = new TaskStore(":memory:");
		const bus = new EventBus();
		app = buildServer({
			store,
			bus,
			orchestrator: new Orchestrator(store, bus, { workRoot: tmpdir() }),
			settings: new SettingsStore(":memory:"),
			workRoot: tmpdir(),
			auth: { token: TOKEN, allowedOrigins: [ORIGIN, "null"] },
		});
		return app;
	}

	afterEach(async () => {
		await app?.close();
		app = undefined;
	});

	it("不带令牌 → 401；令牌错误 → 401；令牌正确 → 200", async () => {
		const s = server();
		expect((await s.inject({ method: "GET", url: "/tasks" })).statusCode).toBe(401);
		expect(
			(await s.inject({ method: "GET", url: "/tasks", headers: { authorization: "Bearer nope" } })).statusCode,
		).toBe(401);
		const ok = await s.inject({ method: "GET", url: "/tasks", headers: AUTH });
		expect(ok.statusCode).toBe(200);
		expect(ok.json()).toEqual([]);
	});

	it.each([
		["GET", "/tasks/x"],
		["GET", "/tasks/x/frames"],
		["GET", "/settings"],
		["GET", "/settings/ai"],
		["GET", "/settings/prompt"],
		["GET", "/static/x/hd/00_00_01.jpg"],
		["GET", "/static/x/grids/grid_001.jpg"],
		["GET", "/events"],
		["POST", "/tasks"],
		["POST", "/tasks/x/export"],
		["POST", "/tasks/x/cancel"],
		["POST", "/cookies/refresh"],
		["POST", "/settings"],
		["DELETE", "/tasks/x"],
	] as const)("每条路由都要令牌：%s %s → 401", async (method, url) => {
		expect((await server().inject({ method, url })).statusCode).toBe(401);
	});

	it("令牌不能放在 URL 里（铁律 #6）", async () => {
		const res = await server().inject({ method: "GET", url: `/tasks?token=${TOKEN}` });
		expect(res.statusCode).toBe(401);
	});

	it("来源不在允许列表 → 403，即使令牌正确（挡网页借开发代理代发请求）", async () => {
		const res = await server().inject({
			method: "POST",
			url: "/tasks/x/export",
			headers: { ...AUTH, origin: "https://evil.example" },
		});
		expect(res.statusCode).toBe(403);
		expect(res.headers["access-control-allow-origin"]).toBeUndefined();
	});

	it("允许的来源：带令牌通过，并回写 CORS 头（含 file:// 页面的 null 来源）", async () => {
		const s = server();
		for (const origin of [ORIGIN, "null"]) {
			const res = await s.inject({ method: "GET", url: "/tasks", headers: { ...AUTH, origin } });
			expect(res.statusCode).toBe(200);
			expect(res.headers["access-control-allow-origin"]).toBe(origin);
		}
	});

	it("允许的来源但没带令牌 → 仍是 401（来源不能代替令牌）", async () => {
		const res = await server().inject({ method: "GET", url: "/tasks", headers: { origin: "null" } });
		expect(res.statusCode).toBe(401);
	});

	it("CORS 预检：允许的来源无需令牌即可通过；不允许的来源 → 403", async () => {
		const s = server();
		const preflight = (origin: string) =>
			s.inject({
				method: "OPTIONS",
				url: "/tasks",
				headers: { origin, "access-control-request-method": "POST" },
			});
		const ok = await preflight(ORIGIN);
		expect(ok.statusCode).toBe(204);
		expect(ok.headers["access-control-allow-origin"]).toBe(ORIGIN);

		const bad = await preflight("https://evil.example");
		expect(bad.statusCode).toBe(403);
		expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
	});

	it("Host 不是回环地址 → 403，即使令牌正确（挡 DNS 重绑定）", async () => {
		const res = await server().inject({
			method: "GET",
			url: "/tasks",
			headers: { ...AUTH, host: "evil.example:8787" },
		});
		expect(res.statusCode).toBe(403);
	});
});
