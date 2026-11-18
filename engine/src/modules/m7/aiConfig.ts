/**
 * 模型服务配置（地址 / 模型 / 喂图策略）与按地址绑定的 Key 表。
 *
 * 【取值优先级】SQLite 里用户保存的值 > 环境变量 > AI_DEFAULTS；库里失效的值（如地址不再合法）静默跳过、落到下一级。
 * 设置每次 resolve()/read() 都重新读库，所以运行中保存的改动对下一个任务生效。
 *
 * 【铁律 #6 / 核心安全属性】Key 只放内存，且与"规范化后的地址"绑定：
 *   某地址的 Key 绝不会被用于、也绝不会被发往另一个地址。Key 永不写入 SettingsStore。
 *   Key 的来源在构造时读一次环境变量；之后只有 setKey 会改内存里的表。
 *   - 表（STILLSCRIBE_AI_KEYS + setKey 写入）→ 来源 "saved"
 *   - 环境单 Key：STILLSCRIBE_AI_API_KEY 属于 STILLSCRIBE_AI_BASE_URL（未设则默认地址）；
 *     旧名 STILLSCRIBE_GEMINI_API_KEY 属于默认地址 → 来源 "env"
 *   - 同一地址两者都有时用表里的；setKey(null) 只删表里的条目。
 */
import { isLoopbackBaseUrl, normalizeBaseUrl, parseKeyTable, withKey, type AIKeyTable } from "@shared/ai";
import {
	AI_DEFAULTS,
	type AIImageSource,
	type AIKeySource,
	type AIKeyUpdate,
	type AIModel,
	type AISettings,
	type AISettingsPatch,
	type AIStructuredMode,
} from "@shared/types";
import type { SettingsStore } from "../../store/settings.ts";

export interface ResolvedAIConfig {
	baseUrl: string;
	model: AIModel;
	imageSource: AIImageSource;
	apiKey?: string;
	keySource: AIKeySource;
	ready: boolean;
	structuredMode?: AIStructuredMode;
}

export class AIConfigError extends Error {}

const K_BASE_URL = "ai.baseUrl";
const K_MODEL = "ai.model";
const K_IMAGE_SOURCE = "ai.imageSource";
const K_STRUCTURED = "ai.structuredModes";

const isImageSource = (v: unknown): v is AIImageSource => v === "grids" || v === "frames";
const isStructuredMode = (v: unknown): v is AIStructuredMode =>
	v === "json_schema" || v === "json_object" || v === "none";
const nonBlank = (v: string | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined);
const modeKey = (baseUrl: string, model: string): string => `${baseUrl}\n${model}`;

export class AIConfig {
	/** 表里的 Key（来源 saved）：构造时读 STILLSCRIBE_AI_KEYS，之后由 setKey 改。 */
	private table: AIKeyTable;
	/** 环境单 Key（来源 env）：构造时读一次，不再变。 */
	private readonly envKeys: AIKeyTable;
	/** 无 SettingsStore 时的内存替身（命令行入口）。 */
	private readonly mem = new Map<string, string>();

	constructor(
		private readonly env: NodeJS.ProcessEnv,
		private readonly settings?: SettingsStore,
	) {
		this.table = parseKeyTable(env.STILLSCRIBE_AI_KEYS);
		const envKeys: AIKeyTable = {};
		const legacy = nonBlank(env.STILLSCRIBE_GEMINI_API_KEY);
		if (legacy) envKeys[AI_DEFAULTS.baseUrl] = legacy;
		const single = nonBlank(env.STILLSCRIBE_AI_API_KEY);
		if (single) {
			// 地址未设/空白 → 默认地址；地址非空但非法 → 丢弃这把 Key（绝不改绑到默认地址，否则会把别家的 Key 发给默认服务）。
			const rawBase = nonBlank(env.STILLSCRIBE_AI_BASE_URL);
			const n = normalizeBaseUrl(rawBase ?? AI_DEFAULTS.baseUrl);
			if (n.ok) envKeys[n.baseUrl] = single;
			else process.stderr.write("[m7] STILLSCRIBE_AI_BASE_URL 不合法，已忽略 STILLSCRIBE_AI_API_KEY\n");
		}
		this.envKeys = envKeys;
	}

	private get(key: string): string | undefined {
		return this.settings ? this.settings.get(key) : this.mem.get(key);
	}

	private set(key: string, value: string): void {
		if (this.settings) this.settings.set(key, value);
		else this.mem.set(key, value);
	}

	private currentBaseUrl(): string {
		for (const raw of [this.get(K_BASE_URL), this.env.STILLSCRIBE_AI_BASE_URL]) {
			if (!raw) continue;
			const n = normalizeBaseUrl(raw);
			if (n.ok) return n.baseUrl;
		}
		return AI_DEFAULTS.baseUrl;
	}

	private currentModel(): AIModel {
		return (
			nonBlank(this.get(K_MODEL)) ??
			nonBlank(this.env.STILLSCRIBE_AI_MODEL) ??
			nonBlank(this.env.STILLSCRIBE_GEMINI_MODEL) ??
			AI_DEFAULTS.model
		);
	}

	private currentImageSource(): AIImageSource {
		const saved = this.get(K_IMAGE_SOURCE);
		if (isImageSource(saved)) return saved;
		const fromEnv = this.env.STILLSCRIBE_AI_IMAGE_SOURCE;
		return isImageSource(fromEnv) ? fromEnv : AI_DEFAULTS.imageSource;
	}

	private readStructuredModes(): Record<string, AIStructuredMode> {
		const raw = this.get(K_STRUCTURED);
		if (!raw) return {};
		try {
			const parsed: unknown = JSON.parse(raw);
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
			const out: Record<string, AIStructuredMode> = {};
			for (const [k, v] of Object.entries(parsed)) if (isStructuredMode(v)) out[k] = v;
			return out;
		} catch {
			return {};
		}
	}

	/** 某地址的 Key 与来源：表优先于环境单 Key。 */
	private keyFor(baseUrl: string): { apiKey?: string; keySource: AIKeySource } {
		const saved = this.table[baseUrl];
		if (saved) return { apiKey: saved, keySource: "saved" };
		const fromEnv = this.envKeys[baseUrl];
		if (fromEnv) return { apiKey: fromEnv, keySource: "env" };
		return { keySource: "none" };
	}

	resolve(): ResolvedAIConfig {
		const baseUrl = this.currentBaseUrl();
		const model = this.currentModel();
		const { apiKey, keySource } = this.keyFor(baseUrl);
		const structuredMode = this.readStructuredModes()[modeKey(baseUrl, model)];
		return {
			baseUrl,
			model,
			imageSource: this.currentImageSource(),
			...(apiKey ? { apiKey } : {}),
			keySource,
			ready: Boolean(apiKey) || isLoopbackBaseUrl(baseUrl),
			...(structuredMode ? { structuredMode } : {}),
		};
	}

	/** 给渲染进程的视图：只说"有没有 Key、来自哪"，绝不含明文。 */
	read(): AISettings {
		const c = this.resolve();
		return {
			baseUrl: c.baseUrl,
			model: c.model,
			imageSource: c.imageSource,
			hasApiKey: Boolean(c.apiKey),
			keySource: c.keySource,
			ready: c.ready,
			keyedBaseUrls: [...new Set([...Object.keys(this.table), ...Object.keys(this.envKeys)])],
		};
	}

	/** 保存非机密设置。先全部校验再写入，任一非法则整体不生效。 */
	save(patch: AISettingsPatch): AISettings {
		let baseUrl: string | undefined;
		if (patch.baseUrl !== undefined) {
			const n = normalizeBaseUrl(patch.baseUrl);
			if (!n.ok) throw new AIConfigError(n.error);
			baseUrl = n.baseUrl;
		}
		let model: string | undefined;
		if (patch.model !== undefined) {
			model = patch.model.trim();
			if (!model) throw new AIConfigError("模型名不能为空");
		}
		if (patch.imageSource !== undefined && !isImageSource(patch.imageSource)) {
			throw new AIConfigError("喂图策略只能是 grids 或 frames");
		}
		if (baseUrl !== undefined) this.set(K_BASE_URL, baseUrl);
		if (model !== undefined) this.set(K_MODEL, model);
		if (patch.imageSource !== undefined) this.set(K_IMAGE_SOURCE, patch.imageSource);
		return this.read();
	}

	/** 写入/清除某地址的 Key（只改内存）。地址先规范化；首尾空白去掉，全空白等同清除。 */
	setKey(update: AIKeyUpdate): AISettings {
		const n = normalizeBaseUrl(update.baseUrl);
		if (!n.ok) throw new AIConfigError(n.error);
		const key = update.apiKey === null ? "" : update.apiKey.trim();
		this.table = withKey(this.table, n.baseUrl, key === "" ? null : key);
		return this.read();
	}

	/** 记住（地址, 模型）实测可用的结构化级别，下次直接用。 */
	rememberStructuredMode(baseUrl: string, model: string, mode: AIStructuredMode): void {
		const modes = this.readStructuredModes();
		modes[modeKey(baseUrl, model)] = mode;
		this.set(K_STRUCTURED, JSON.stringify(modes));
	}
}
