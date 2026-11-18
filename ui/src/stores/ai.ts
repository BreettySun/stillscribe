/**
 * 模型服务设置（Pinia）：地址 / 模型 / 喂图方式 / Key 状态，均由引擎持有。
 * 渲染进程不持有 Key：Key 只经 bridge.setAIKey 写入主进程，界面只看到 hasApiKey / keyedBaseUrls。
 * 状态都在内存里，不用 localStorage（CLAUDE.md 铁律 #9）。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AISettings, AISettingsPatch, AITestResult } from "@shared/types";
import { api } from "../api/client";
import { setAIKey } from "../bridge";

export const useAIStore = defineStore("ai", () => {
	const settings = ref<AISettings | null>(null);
	const ready = computed(() => settings.value?.ready ?? false);

	/** 从引擎拉取；引擎未就绪时保持原状。 */
	async function load(): Promise<void> {
		try {
			settings.value = await api.getAISettings();
		} catch {
			/* 引擎未就绪 */
		}
	}

	async function save(patch: AISettingsPatch): Promise<void> {
		settings.value = await api.saveAISettings(patch);
	}

	async function setKey(
		baseUrl: string,
		apiKey: string | null,
	): Promise<{ persisted: boolean }> {
		const r = await setAIKey(baseUrl, apiKey);
		await load();
		return r;
	}

	function test(): Promise<AITestResult> {
		return api.testAI();
	}

	return { settings, ready, load, save, setKey, test };
});
