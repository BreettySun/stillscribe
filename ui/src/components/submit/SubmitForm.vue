<script setup lang="ts">
/** 新建任务态（无选中）：URL 主输入 + 折叠的高级选项 + 提交 CTA。 */
import { computed, reactive, ref, onMounted } from "vue";
import { useMessage } from "naive-ui";
import { DEFAULTS, type TaskParams } from "@shared/types";
import { api } from "../../api/client";
import { useTasksStore } from "../../stores/tasks";
import { useSettingsStore } from "../../stores/settings";
import AdvancedOptions, { type AdvancedModel } from "./AdvancedOptions.vue";
import PromptEditor from "./PromptEditor.vue";

const store = useTasksStore();
const settings = useSettingsStore();
const message = useMessage();

const urlsText = ref("");
const busy = ref(false);

// 提示词：defaultPrompt=引擎默认模板（底稿/恢复默认基准）；promptText=本次提交实际使用。
const defaultPrompt = ref("");
const promptText = ref("");

// 全自动(auto)是否就绪：引擎侧 engine/.env 是否配了 Gemini Key。仅决定 auto 选项是否可选。
const aiHasKey = ref(false);
onMounted(async () => {
	try {
		aiHasKey.value = (await api.getAISettings()).ready;
	} catch {
		/* 引擎未就绪/旧版无此端点 → 视为未配置，auto 不可选 */
	}
	try {
		defaultPrompt.value = (await api.getPromptTemplate()).template;
		promptText.value = defaultPrompt.value;
	} catch {
		/* 引擎未就绪/旧版无此端点 → 提示词区留空，提交时不带 override */
	}
});

let adv = reactive<AdvancedModel>({
	quality: DEFAULTS.quality,
	mode: DEFAULTS.mode,
	dedup: DEFAULTS.dedup,
	threshold: DEFAULTS.dedupThreshold,
});

const urls = computed(() =>
	urlsText.value
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean),
);

async function onSubmit(): Promise<void> {
	if (urls.value.length === 0) return;
	// 提示词被改过才带 override；未改/未加载到默认模板时省略，由引擎用默认模板。
	const overrideEdited =
		promptText.value.trim() !== "" && promptText.value !== defaultPrompt.value;
	const params: TaskParams[] = urls.value.map((url) => ({
		url,
		quality: adv.quality,
		dedup: adv.dedup,
		...(adv.dedup && adv.threshold != null
			? { dedupThreshold: adv.threshold }
			: {}),
		mode: adv.mode,
		// cookie 来源统一取标题栏全局设置；没有 cookies.txt 时作 --cookies-from-browser 回退。
		browser: settings.cookieBrowser,
		...(overrideEdited ? { promptOverride: promptText.value } : {}),
	}));
	busy.value = true;
	try {
		const ids = await store.submit(params);
		urlsText.value = "";
		// 提示词重置回默认，避免本次编辑误带到下一批提交。
		promptText.value = defaultPrompt.value;
		message.success(`已提交 ${ids.length} 个任务`);
		if (ids[0]) store.setSelected(ids[0]);
	} catch (e) {
		message.error(e instanceof Error ? e.message : String(e));
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<n-space
		vertical
		:size="18">
		<div>
			<h2 class="form-title">新建任务</h2>
			<p class="form-hint">
				YouTube URL（每行一个，单批 ≤ {{ DEFAULTS.maxBatchSize }}）
			</p>
		</div>

		<n-input
			v-model:value="urlsText"
			type="textarea"
			:rows="5"
			placeholder="https://www.youtube.com/watch?v=..."
			:autosize="{ minRows: 5 }" />

		<PromptEditor
			v-model="promptText"
			:default-template="defaultPrompt" />

		<n-space align="center">
			<n-button
				type="primary"
				size="large"
				:disabled="urls.length === 0"
				:loading="busy"
				@click="onSubmit">
				▶ 提交{{ urls.length > 1 ? ` ${urls.length} 个` : "" }}任务
			</n-button>
		</n-space>

		<AdvancedOptions
			v-model="adv"
			:ai-has-key="aiHasKey" />
	</n-space>
</template>

<style scoped>
.form-title {
	margin: 0 0 4px;
	font-size: 18px;
}
.form-hint {
	margin: 0;
	font-size: 12px;
	color: var(--c-muted);
}
</style>
