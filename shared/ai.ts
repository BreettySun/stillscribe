// 模型服务（OpenAI 兼容）相关的纯函数与常量。
// 引擎、Electron 主进程、界面三端共用：不得 import 任何 Node 或浏览器专有模块（全局 URL 可用）。

import { AI_DEFAULTS } from "./types";

/** 默认模型服务地址；字面量只在 AI_DEFAULTS 里有一处。 */
export const DEFAULT_AI_BASE_URL = AI_DEFAULTS.baseUrl;

export type NormalizeResult = { ok: true; baseUrl: string } | { ok: false; error: string };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** 规范化模型服务地址：https，或仅限回环地址的 http；去掉结尾斜杠、/chat/completions、query、hash。 */
export function normalizeBaseUrl(input: string): NormalizeResult {
	const trimmed = (input ?? "").trim();
	if (!trimmed) return { ok: false, error: "地址不能为空" };
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return { ok: false, error: "地址格式不正确" };
	}
	if (url.protocol === "http:") {
		if (!LOOPBACK_HOSTS.has(url.hostname)) {
			return { ok: false, error: "http 仅允许本机地址（localhost / 127.0.0.1 / [::1]），其余请用 https" };
		}
	} else if (url.protocol !== "https:") {
		return { ok: false, error: "地址必须以 https:// 开头" };
	}
	let path = url.pathname.replace(/\/+$/, "");
	path = path.replace(/\/chat\/completions$/, "").replace(/\/+$/, "");
	return { ok: true, baseUrl: `${url.protocol}//${url.host}${path}` };
}

/** 是否回环地址（localhost / 127.0.0.1 / [::1]）。非法地址返回 false。 */
export function isLoopbackBaseUrl(baseUrl: string): boolean {
	try {
		return LOOPBACK_HOSTS.has(new URL(baseUrl).hostname);
	} catch {
		return false;
	}
}

/** 规范化地址 → Key。 */
export type AIKeyTable = Record<string, string>;

/** 解析 JSON 形式的 Key 表；非法输入返回空表，丢弃地址键不合法或值不是非空字符串的条目。 */
export function parseKeyTable(json: string | undefined): AIKeyTable {
	if (!json) return {};
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return {};
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
	const table: AIKeyTable = {};
	for (const [k, v] of Object.entries(raw)) {
		if (typeof v !== "string" || v === "") continue;
		const n = normalizeBaseUrl(k);
		if (!n.ok || n.baseUrl !== k) continue;
		table[k] = v;
	}
	return table;
}

/** 写入/覆盖/清除（apiKey 为 null）某地址的 Key，返回新表，不改原表。 */
export function withKey(table: AIKeyTable, baseUrl: string, apiKey: string | null): AIKeyTable {
	const next = { ...table };
	if (apiKey === null) delete next[baseUrl];
	else next[baseUrl] = apiKey;
	return next;
}

/** 把旧版单 Key 记到默认地址下，已有的不覆盖。 */
export function mergeLegacyKey(table: AIKeyTable, legacyKey: string | undefined): AIKeyTable {
	if (!legacyKey || table[DEFAULT_AI_BASE_URL]) return { ...table };
	return { ...table, [DEFAULT_AI_BASE_URL]: legacyKey };
}

export interface AIPreset {
	id: string;
	label: string;
	baseUrl: string;
	defaultModel: string;
}

export const AI_PRESETS: readonly AIPreset[] = [
	{ id: "gemini", label: "Google Gemini", baseUrl: DEFAULT_AI_BASE_URL, defaultModel: "gemini-2.5-flash" },
];
