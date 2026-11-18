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

// ---- Key 文件的加载 / 迁移 / 写入决策（Electron 主进程 aiKeys.ts 只负责 I/O，按这里的计划执行）----

/** userData 下 Key 表文件 ai-keys.enc 的读取结果。unreadable = 存在但没能读出合法表（解密失败、内容非法、或加载时加密不可用）。 */
export type KeyFileState = "missing" | "unreadable" | { table: AIKeyTable };
/** 旧版 gemini-key.enc：unreadable = 存在但无法解密（含加载时加密不可用）——它可能是用户唯一的副本，永不删除。key 为空表示解出空串。 */
export type LegacyEncState = "missing" | "unreadable" | { key: string | undefined };
/** 旧版明文 gemini-key.txt：key 为空表示内容为空或读取失败（仍可清理）。 */
export type LegacyTxtState = "missing" | { key: string | undefined };
export type LegacyKeyFile = "gemini-key.enc" | "gemini-key.txt";

export interface KeyLoadInput {
	encryptionAvailable: boolean;
	keyFile: KeyFileState;
	legacyEnc: LegacyEncState;
	legacyTxt: LegacyTxtState;
}

export interface KeyLoadPlan {
	/** 本次会话使用的表（已并入旧 Key）。 */
	table: AIKeyTable;
	/** 是否需要把 table 写入 ai-keys.enc。 */
	save: boolean;
	/** 仅当这次保存成功后才可删除的旧文件。 */
	deleteIfSaved: LegacyKeyFile[];
	/** 无需保存即可删除的旧文件（表本就读自 ai-keys.enc 且已含其 Key）。 */
	deleteNow: LegacyKeyFile[];
	/** ai-keys.enc 存在但未能读取：此后写入前必须先改名保留，绝不直接覆盖。 */
	markKeyFileUnreadable: boolean;
}

/**
 * 加载与迁移计划。旧文件只在"返回的表已安全落在 ai-keys.enc"时清理：刚保存成功，或表读自 ai-keys.enc
 * 且无需改动；加密不可用时什么都不写也不删。无法解密的旧 gemini-key.enc 永远保留。
 */
export function planKeyLoad(input: KeyLoadInput): KeyLoadPlan {
	const { encryptionAvailable, keyFile, legacyEnc, legacyTxt } = input;
	const loaded = typeof keyFile === "object" ? keyFile.table : {};
	const legacyKey =
		(typeof legacyEnc === "object" ? legacyEnc.key : undefined) ||
		(typeof legacyTxt === "object" ? legacyTxt.key : undefined);
	const table = mergeLegacyKey(loaded, legacyKey);
	const changed = JSON.stringify(table) !== JSON.stringify(loaded);

	const deletable: LegacyKeyFile[] = [];
	if (typeof legacyEnc === "object") deletable.push("gemini-key.enc");
	if (legacyTxt !== "missing") deletable.push("gemini-key.txt");

	const save = changed && encryptionAvailable;
	const loadedFromDisk = typeof keyFile === "object";
	return {
		table,
		save,
		deleteIfSaved: save ? deletable : [],
		deleteNow: !changed && loadedFromDisk ? deletable : [],
		// 加载时加密不可用的 ai-keys.enc 根本没读过，不标记（沿用现状）。
		markKeyFileUnreadable: keyFile === "unreadable" && encryptionAvailable,
	};
}

/** 解密后的 ai-keys.enc 文本 → 表；解出来不是合法表（且不是字面量 {}）视为 unreadable，别拿空表覆盖它。 */
export function decodeKeyFile(text: string): Exclude<KeyFileState, "missing"> {
	const table = parseKeyTable(text);
	if (Object.keys(table).length === 0 && text.trim() !== "{}") return "unreadable";
	return { table };
}

export interface KeySavePlan {
	write: boolean;
	/** 写入前先把现有 ai-keys.enc 改名保留；改名失败则放弃写入。 */
	renameAsideFirst: boolean;
}

/** 写入计划：加密不可用不写；被标记为不可读且仍存在的 ai-keys.enc 先改名保留。 */
export function planKeySave(input: {
	encryptionAvailable: boolean;
	keyFileExists: boolean;
	keyFileUnreadable: boolean;
}): KeySavePlan {
	if (!input.encryptionAvailable) return { write: false, renameAsideFirst: false };
	return { write: true, renameAsideFirst: input.keyFileUnreadable && input.keyFileExists };
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
