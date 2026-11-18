import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { AI_DEFAULTS, type AISettings, type AITestResult } from "@shared/types";
import { buildServer } from "./server.ts";
import { AIConfig } from "./modules/m7/aiConfig.ts";
import { TaskStore } from "./store/tasks.ts";
import { SettingsStore } from "./store/settings.ts";
import { EventBus } from "./orchestrator/events.ts";
import { Orchestrator } from "./orchestrator/queue.ts";
import { startFake, closeAllFakes, ok } from "./modules/m7/testFake.ts";

let app: FastifyInstance | undefined;

let lastAI: AIConfig | undefined;

function makeApp(): FastifyInstance {
	const store = new TaskStore(":memory:");
	const bus = new EventBus();
	const settings = new SettingsStore(":memory:");
	app = buildServer({
		store,
		bus,
		orchestrator: new Orchestrator(store, bus, { workRoot: tmpdir() }),
		settings,
		workRoot: tmpdir(),
		ai: (lastAI = new AIConfig({}, settings)),
		auth: { token: "t", allowedOrigins: [] },
	});
	return app;
}

function call(
	a: FastifyInstance,
	method: "GET" | "POST" | "PUT",
	url: string,
	payload?: unknown,
	headers: Record<string, string> = { authorization: "Bearer t" },
) {
	return a.inject({ method, url, payload: payload as never, headers: { host: "127.0.0.1", ...headers } });
}

afterEach(async () => {
	await closeAllFakes();
	await app?.close();
	app = undefined;
});

describe("模型服务设置路由", () => {
	it.each([
		["GET", "/settings/ai"],
		["POST", "/settings/ai"],
		["PUT", "/settings/ai/key"],
	] as const)("%s %s 不带令牌 → 401", async (method, url) => {
		const res = await call(makeApp(), method, url, method === "GET" ? undefined : {}, {});
		expect(res.statusCode).toBe(401);
	});

	it("POST /settings/ai 保存并返回规范化后的设置", async () => {
		const a = makeApp();
		const res = await call(a, "POST", "/settings/ai", {
			baseUrl: "https://a.com/v1/",
			model: "m1",
			imageSource: "frames",
		});
		expect(res.statusCode).toBe(200);
		const body = res.json() as AISettings;
		expect(body.baseUrl).toBe("https://a.com/v1");
		expect(body.model).toBe("m1");
		expect(body.imageSource).toBe("frames");
		const got = await call(a, "GET", "/settings/ai");
		expect(got.json()).toEqual(body);
	});

	it.each([{ baseUrl: "http://a.com/v1" }, { model: "" }, { imageSource: "x" }, { baseUrl: 5 }])(
		"非法值 %j → 400",
		async (payload) => {
			const res = await call(makeApp(), "POST", "/settings/ai", payload);
			expect(res.statusCode).toBe(400);
		},
	);

	it("POST /settings/ai 非对象 body → 400", async () => {
		const res = await call(makeApp(), "POST", "/settings/ai", [1]);
		expect(res.statusCode).toBe(400);
	});

	it("PUT /settings/ai/key 写入后 hasApiKey 为真，响应里不含 Key", async () => {
		const a = makeApp();
		const res = await call(a, "PUT", "/settings/ai/key", {
			baseUrl: AI_DEFAULTS.baseUrl,
			apiKey: "sk-secret",
		});
		expect(res.statusCode).toBe(200);
		expect(res.body).not.toContain("sk-secret");
		const json = res.json() as AISettings;
		expect(json.hasApiKey).toBe(true);
		expect(json.keySource).toBe("saved");
		const got = await call(a, "GET", "/settings/ai");
		expect(got.body).not.toContain("sk-secret");
	});

	it("PUT /settings/ai/key apiKey=null 清除", async () => {
		const a = makeApp();
		await call(a, "PUT", "/settings/ai/key", { baseUrl: AI_DEFAULTS.baseUrl, apiKey: "sk-secret" });
		const res = await call(a, "PUT", "/settings/ai/key", { baseUrl: AI_DEFAULTS.baseUrl, apiKey: null });
		expect(res.statusCode).toBe(200);
		const json = res.json() as AISettings;
		expect(json.hasApiKey).toBe(false);
		expect(json.keySource).toBe("none");
	});

	it.each([
		{},
		{ baseUrl: "https://a.com/v1" },
		{ baseUrl: "http://a.com/v1", apiKey: "k" },
		{ baseUrl: "https://a.com/v1", apiKey: 5 },
	])("PUT /settings/ai/key 非法 body %j → 400", async (payload) => {
		const res = await call(makeApp(), "PUT", "/settings/ai/key", payload);
		expect(res.statusCode).toBe(400);
	});

	it("出错响应里也不回显请求体中的 Key", async () => {
		const res = await call(makeApp(), "PUT", "/settings/ai/key", {
			baseUrl: "http://a.com/v1",
			apiKey: "sk-secret",
		});
		expect(res.statusCode).toBe(400);
		expect(res.body).not.toContain("sk-secret");
	});

	it("请求体不是合法 JSON 时 → 400，响应不含请求体里的 Key（防 Fastify 升级后开始回显解析错误原文）", async () => {
		const a = makeApp();
		const res = await a.inject({
			method: "PUT",
			url: "/settings/ai/key",
			payload: '{"apiKey":sk-secret}',
			headers: { host: "127.0.0.1", authorization: "Bearer t", "content-type": "application/json" },
		});
		expect(res.statusCode).toBe(400);
		expect(res.body).not.toContain("sk-secret");
	});

	it("POST /settings/ai/test 不带令牌 → 401", async () => {
		const res = await call(makeApp(), "POST", "/settings/ai/test", undefined, {});
		expect(res.statusCode).toBe(401);
	});

	it("POST /settings/ai/test 返回 AITestResult 并记住结构化级别", async () => {
		const fake = await startFake((req) => {
			if (!req.body.response_format) return ok("ok");
			return req.body.response_format.type === "json_schema"
				? { status: 400, json: { error: { message: "response_format not supported" } } }
				: ok('{"color":"red"}');
		});
		const a = makeApp();
		const saved = await call(a, "POST", "/settings/ai", { baseUrl: fake.baseUrl });
		expect(saved.statusCode).toBe(200);
		const res = await call(a, "POST", "/settings/ai/test");
		expect(res.statusCode).toBe(200);
		const body = res.json() as AITestResult;
		expect(body).toMatchObject({ ok: true, seesImage: true, structuredMode: "json_object" });
		expect(lastAI!.resolve().structuredMode).toBe("json_object");
	});

	it("Key 不跨地址：给 A 存了 Key、当前地址改为 B，测试连接时 B 收不到 Authorization，A 收不到任何请求", async () => {
		const fakeA = await startFake(() => ok("ok"));
		const fakeB = await startFake((req) => (req.body.response_format ? ok('{"color":"red"}') : ok("ok")));
		const a = makeApp();
		expect((await call(a, "POST", "/settings/ai", { baseUrl: fakeA.baseUrl })).statusCode).toBe(200);
		expect((await call(a, "PUT", "/settings/ai/key", { baseUrl: fakeA.baseUrl, apiKey: "sk-for-a" })).statusCode).toBe(200);
		expect((await call(a, "POST", "/settings/ai", { baseUrl: fakeB.baseUrl })).statusCode).toBe(200);
		const res = await call(a, "POST", "/settings/ai/test");
		expect(res.statusCode).toBe(200);
		expect((res.json() as AITestResult).ok).toBe(true);
		expect(fakeB.requests.length).toBeGreaterThan(0);
		for (const r of fakeB.requests) {
			expect(r.headers.authorization).toBeUndefined();
			expect(JSON.stringify(r)).not.toContain("sk-for-a");
		}
		expect(fakeA.requests).toHaveLength(0);
	});
});
