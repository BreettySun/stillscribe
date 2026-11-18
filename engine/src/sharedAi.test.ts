import { describe, expect, it } from "vitest";
import {
	DEFAULT_AI_BASE_URL,
	isLoopbackBaseUrl,
	mergeLegacyKey,
	normalizeBaseUrl,
	parseKeyTable,
	withKey,
	type AIKeyTable,
} from "@shared/ai";

describe("normalizeBaseUrl", () => {
	it.each([
		["https://api.example.com/v1", "https://api.example.com/v1"],
		["  https://api.example.com/v1/  ", "https://api.example.com/v1"],
		["https://api.example.com/v1/chat/completions", "https://api.example.com/v1"],
		["https://api.example.com/v1/chat/completions/", "https://api.example.com/v1"],
		["http://localhost:11434/v1", "http://localhost:11434/v1"],
		["http://127.0.0.1:8080/v1", "http://127.0.0.1:8080/v1"],
		["http://[::1]:8080/v1", "http://[::1]:8080/v1"],
	])("接受并归一 %j", (input, want) => {
		expect(normalizeBaseUrl(input)).toEqual({ ok: true, baseUrl: want });
	});
	it.each(["", "   ", "not a url", "ftp://x.com/v1", "http://api.example.com/v1", "http://192.168.1.5:11434/v1"])(
		"拒绝 %j",
		(input) => {
			expect(normalizeBaseUrl(input).ok).toBe(false);
		},
	);
	it("去掉 query 和 hash", () => {
		expect(normalizeBaseUrl("https://a.com/v1?key=secret#x")).toEqual({ ok: true, baseUrl: "https://a.com/v1" });
	});
});

describe("isLoopbackBaseUrl", () => {
	it("回环为真，其余为假", () => {
		expect(isLoopbackBaseUrl("http://localhost:11434/v1")).toBe(true);
		expect(isLoopbackBaseUrl("https://api.example.com/v1")).toBe(false);
	});
});

describe("Key 表", () => {
	it("parseKeyTable 对非法输入返回空表", () => {
		for (const bad of [undefined, "", "not json", "[]", "null", '{"a":1}']) expect(parseKeyTable(bad)).toEqual({});
	});
	it("parseKeyTable 丢弃非字符串值和不合法的地址键", () => {
		expect(parseKeyTable('{"https://a.com/v1":"k1","http://evil.com":"k2","https://b.com/v1":5}')).toEqual({
			"https://a.com/v1": "k1",
		});
	});
	it("withKey 写入、覆盖、清除，且不改原表", () => {
		const t0: AIKeyTable = {};
		const t1 = withKey(t0, "https://a.com/v1", "k1");
		expect(t0).toEqual({});
		expect(t1).toEqual({ "https://a.com/v1": "k1" });
		expect(withKey(t1, "https://a.com/v1", null)).toEqual({});
	});
	it("mergeLegacyKey 把旧 Key 记到默认地址，但不覆盖已有的", () => {
		expect(mergeLegacyKey({}, "old")).toEqual({ [DEFAULT_AI_BASE_URL]: "old" });
		expect(mergeLegacyKey({ [DEFAULT_AI_BASE_URL]: "new" }, "old")).toEqual({ [DEFAULT_AI_BASE_URL]: "new" });
		expect(mergeLegacyKey({}, undefined)).toEqual({});
	});
});
