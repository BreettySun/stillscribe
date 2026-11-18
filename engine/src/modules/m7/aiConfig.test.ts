import { describe, expect, it } from "vitest";
import { AI_DEFAULTS } from "@shared/types";
import { SettingsStore } from "../../store/settings.ts";
import { AIConfig, AIConfigError } from "./aiConfig.ts";

const mem = () => new SettingsStore(":memory:");
const A = "https://a.com/v1";
const B = "https://b.com/v1";

describe("AIConfig", () => {
	it("全空时用默认值，未就绪", () => {
		expect(new AIConfig({}, mem()).read()).toEqual({
			baseUrl: AI_DEFAULTS.baseUrl,
			model: "gemini-2.5-flash",
			imageSource: "grids",
			hasApiKey: false,
			keySource: "none",
			ready: false,
			keyedBaseUrls: [],
		});
	});

	it("优先级：保存的值 > 环境变量 > 默认", () => {
		const c = new AIConfig({ STILLSCRIBE_AI_MODEL: "env-m" }, mem());
		expect(c.read().model).toBe("env-m");
		c.save({ model: "saved-m" });
		expect(c.read().model).toBe("saved-m");
		expect(c.resolve().model).toBe("saved-m");
		expect(new AIConfig({}, mem()).read().model).toBe(AI_DEFAULTS.model);
	});

	it("旧环境变量仍可用：GEMINI_API_KEY 属于默认地址，GEMINI_MODEL 作模型兜底", () => {
		const c = new AIConfig({ STILLSCRIBE_GEMINI_API_KEY: "old", STILLSCRIBE_GEMINI_MODEL: "old-m" }, mem());
		const s = c.read();
		expect(s.model).toBe("old-m");
		expect(s.hasApiKey).toBe(true);
		expect(s.keySource).toBe("env");
		expect(s.ready).toBe(true);
		expect(s.keyedBaseUrls).toEqual([AI_DEFAULTS.baseUrl]);
		// 新名优先于旧名
		const c2 = new AIConfig({ STILLSCRIBE_AI_MODEL: "new-m", STILLSCRIBE_GEMINI_MODEL: "old-m" }, mem());
		expect(c2.read().model).toBe("new-m");
	});

	it("STILLSCRIBE_AI_API_KEY 属于 STILLSCRIBE_AI_BASE_URL", () => {
		const c = new AIConfig({ STILLSCRIBE_AI_BASE_URL: A, STILLSCRIBE_AI_API_KEY: "k" }, mem());
		expect(c.resolve().baseUrl).toBe(A);
		expect(c.resolve().apiKey).toBe("k");
		expect(c.read().keyedBaseUrls).toEqual([A]);
		c.save({ baseUrl: B });
		expect(c.resolve().apiKey).toBeUndefined();
		// 未设 BASE_URL 时属于默认地址
		const d = new AIConfig({ STILLSCRIBE_AI_API_KEY: "k" }, mem());
		expect(d.read().keyedBaseUrls).toEqual([AI_DEFAULTS.baseUrl]);
	});

	it("STILLSCRIBE_AI_KEYS 非法 JSON → 视为空表，不抛错", () => {
		const c = new AIConfig({ STILLSCRIBE_AI_KEYS: "{not json" }, mem());
		expect(c.read().keyedBaseUrls).toEqual([]);
		expect(c.read().hasApiKey).toBe(false);
	});

	it("STILLSCRIBE_AI_KEYS 的表项来源为 saved", () => {
		const c = new AIConfig({ STILLSCRIBE_AI_KEYS: JSON.stringify({ [AI_DEFAULTS.baseUrl]: "tk" }) }, mem());
		expect(c.read().keySource).toBe("saved");
		expect(c.resolve().apiKey).toBe("tk");
	});

	it("Key 与地址绑定：换地址后旧 Key 不可用，切回后恢复", () => {
		const c = new AIConfig({}, mem());
		c.setKey({ baseUrl: A, apiKey: "ka" });
		c.save({ baseUrl: A });
		expect(c.resolve().apiKey).toBe("ka");
		c.save({ baseUrl: B });
		expect(c.resolve().apiKey).toBeUndefined();
		expect(c.read().ready).toBe(false);
		c.save({ baseUrl: A });
		expect(c.resolve().apiKey).toBe("ka");
	});

	it("表里的 Key 优先于环境变量；清除后回落到环境变量", () => {
		const c = new AIConfig({ STILLSCRIBE_GEMINI_API_KEY: "envk" }, mem());
		c.setKey({ baseUrl: AI_DEFAULTS.baseUrl, apiKey: "saved" });
		expect(c.resolve().apiKey).toBe("saved");
		expect(c.resolve().keySource).toBe("saved");
		c.setKey({ baseUrl: AI_DEFAULTS.baseUrl, apiKey: null });
		expect(c.resolve().apiKey).toBe("envk");
		expect(c.resolve().keySource).toBe("env");
	});

	it("回环地址没有 Key 也算就绪", () => {
		const c = new AIConfig({}, mem());
		c.save({ baseUrl: "http://localhost:11434/v1" });
		const s = c.read();
		expect(s.ready).toBe(true);
		expect(s.hasApiKey).toBe(false);
		expect(c.resolve().ready).toBe(true);
	});

	it("setKey 去掉首尾空白；全空白等同清除", () => {
		const c = new AIConfig({}, mem());
		c.save({ baseUrl: A });
		c.setKey({ baseUrl: A, apiKey: " k1\n" });
		expect(c.resolve().apiKey).toBe("k1");
		c.setKey({ baseUrl: A, apiKey: "   " });
		expect(c.resolve().apiKey).toBeUndefined();
		expect(c.read().hasApiKey).toBe(false);
	});

	it("setKey 对地址做规范化，非法地址抛 AIConfigError", () => {
		const c = new AIConfig({}, mem());
		c.setKey({ baseUrl: "https://a.com/v1/", apiKey: "k" });
		expect(c.read().keyedBaseUrls).toEqual([A]);
		expect(() => c.setKey({ baseUrl: "http://a.com/v1", apiKey: "k" })).toThrow(AIConfigError);
	});

	it("save 对地址做规范化，拒绝非法值", () => {
		const c = new AIConfig({}, mem());
		c.save({ baseUrl: "https://a.com/v1/" });
		expect(c.read().baseUrl).toBe(A);
		expect(() => c.save({ baseUrl: "http://a.com/v1" })).toThrow(AIConfigError);
		expect(() => c.save({ model: "  " })).toThrow(AIConfigError);
		expect(() => c.save({ imageSource: "x" as any })).toThrow(AIConfigError);
	});

	it("SQLite 里失效的地址不崩溃，回落到环境变量/默认", () => {
		const s = mem();
		s.set("ai.baseUrl", "http://evil.com/v1");
		s.set("ai.imageSource", "bogus");
		const c = new AIConfig({ STILLSCRIBE_AI_BASE_URL: B }, s);
		expect(c.resolve().baseUrl).toBe(B);
		expect(c.read().imageSource).toBe("grids");
		expect(new AIConfig({}, s).read().baseUrl).toBe(AI_DEFAULTS.baseUrl);
	});

	it("read() 与 SettingsStore 里都不出现 Key", () => {
		const s = mem();
		const c = new AIConfig({}, s);
		c.setKey({ baseUrl: A, apiKey: "ka" });
		c.save({ baseUrl: A, model: "m", imageSource: "frames" });
		c.rememberStructuredMode(A, "m", "json_object");
		expect(JSON.stringify(c.read())).not.toContain("ka");
		for (const k of ["ai.baseUrl", "ai.model", "ai.imageSource", "ai.structuredModes"]) {
			expect(s.get(k) ?? "").not.toContain("ka");
		}
	});

	it("结构化级别按（地址, 模型）记忆", () => {
		const c = new AIConfig({}, mem());
		c.save({ baseUrl: A, model: "m1" });
		expect(c.resolve().structuredMode).toBeUndefined();
		c.rememberStructuredMode(A, "m1", "json_object");
		expect(c.resolve().structuredMode).toBe("json_object");
		c.save({ model: "m2" });
		expect(c.resolve().structuredMode).toBeUndefined();
		c.save({ baseUrl: B, model: "m1" });
		expect(c.resolve().structuredMode).toBeUndefined();
	});

	it("无 settings 时也可用（命令行入口），save / remember 只在内存生效", () => {
		const c = new AIConfig({ STILLSCRIBE_AI_MODEL: "env-m" });
		expect(c.resolve().model).toBe("env-m");
		c.save({ model: "mem-m", baseUrl: A });
		expect(c.resolve().model).toBe("mem-m");
		c.rememberStructuredMode(A, "mem-m", "none");
		expect(c.resolve().structuredMode).toBe("none");
		expect(new AIConfig({ STILLSCRIBE_AI_MODEL: "env-m" }).resolve().model).toBe("env-m");
	});
});
