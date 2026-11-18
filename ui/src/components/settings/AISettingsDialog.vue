<script setup lang="ts">
/**
 * 模型服务设置对话框：服务预设 / 地址 / Key / 模型 / 喂图方式 + 测试连接。
 * 表单是本地状态，点保存才生效；Key 只写不回显，保存成功后清空。
 */
import { computed, ref, watch } from "vue";
import { AI_PRESETS, normalizeBaseUrl } from "@shared/ai";
import type { AIImageSource, AITestResult } from "@shared/types";
import { useAIStore } from "../../stores/ai";
import { canStoreAIKey } from "../../bridge";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ "update:show": [value: boolean] }>();

const store = useAIStore();
const message = useMessage();

const CUSTOM = "custom";

const preset = ref<string>(CUSTOM);
const baseUrl = ref("");
const apiKey = ref("");
const model = ref("");
const imageSource = ref<AIImageSource>("grids");

const busy = ref<"save" | "test" | "clear" | null>(null);
const errorText = ref("");
const testResult = ref<AITestResult | null>(null);
/** 用户自上次填充后是否改过表单；未改过时，引擎设置晚到会自动重填。 */
const dirty = ref(false);

const SERVICE_OPTIONS = [
	...AI_PRESETS.map((p) => ({ label: p.label, value: p.id })),
	{ label: "自定义", value: CUSTOM },
];

const TIER_TEXT: Record<"json_schema" | "json_object" | "none", string> = {
	json_schema: "支持强制结构",
	json_object: "仅保证是 JSON",
	none: "不支持强制输出格式，生成可能偶尔失败并转为人工回填",
};

/** 地址（规范化后）等于某预设时返回该预设 id，否则 "custom"。 */
function detectPreset(url: string): string {
	const n = normalizeBaseUrl(url);
	if (!n.ok) return CUSTOM;
	return AI_PRESETS.find((p) => p.baseUrl === n.baseUrl)?.id ?? CUSTOM;
}

function fillFromStore(): void {
	const s = store.settings;
	const first = AI_PRESETS[0];
	baseUrl.value = s?.baseUrl ?? first?.baseUrl ?? "";
	model.value = s?.model ?? first?.defaultModel ?? "";
	imageSource.value = s?.imageSource ?? "grids";
	preset.value = detectPreset(baseUrl.value);
	apiKey.value = "";
	errorText.value = "";
	testResult.value = null;
	dirty.value = false;
}

const NOT_LOADED_TEXT = "无法从引擎读取当前设置，请确认引擎已连接后重新打开此窗口";

watch(
	() => props.show,
	async (v) => {
		if (!v) return;
		fillFromStore();
		// 还没拿到引擎设置：再拉一次；仍失败就明说，不让用户拿兜底值去覆盖已保存的配置。
		if (!store.settings) {
			await store.load();
			if (!store.settings && props.show && !dirty.value) {
				errorText.value = NOT_LOADED_TEXT;
			}
		}
	},
	{ immediate: true },
);

// 设置晚到（或在别处被刷新）且表单没被改过：按引擎的值重填。
watch(
	() => store.settings,
	(s) => {
		if (props.show && s && !dirty.value) fillFromStore();
	},
);

/** 表单任一项变动：标记已改，并作废旧的测试结果（结果只对应实际测过的配置）。 */
function touch(): void {
	dirty.value = true;
	testResult.value = null;
}
function onUrlInput(v: string): void {
	baseUrl.value = v;
	touch();
}
function onModelInput(v: string): void {
	model.value = v;
	touch();
}
function onKeyInput(v: string): void {
	apiKey.value = v;
	touch();
}
function onImageSourceChange(v: AIImageSource): void {
	imageSource.value = v;
	touch();
}
function onShowUpdate(v: boolean): void {
	// 请求进行中不允许关闭（与 mask-closable / close-on-esc 一致）。
	if (!v && busy.value !== null) return;
	emit("update:show", v);
}

function onPresetChange(id: string): void {
	preset.value = id;
	touch();
	const p = AI_PRESETS.find((x) => x.id === id);
	if (p) {
		baseUrl.value = p.baseUrl;
		model.value = p.defaultModel;
	}
}

const normalized = computed(() => normalizeBaseUrl(baseUrl.value));
const urlError = computed(() =>
	normalized.value.ok ? "" : normalized.value.error,
);
const modelEmpty = computed(() => model.value.trim() === "");
const canSubmit = computed(
	() =>
		store.settings !== null &&
		normalized.value.ok &&
		!modelEmpty.value &&
		busy.value === null,
);

/** Key 状态按表单里当前填的地址（规范化后）判断，不论它是不是已保存的当前地址。 */
const keyStatus = computed<"env" | "saved" | "none">(() => {
	const s = store.settings;
	const n = normalized.value;
	if (!s || !n.ok) return "none";
	return s.keySources[n.baseUrl] ?? "none";
});

const keyPlaceholder = computed(() =>
	canStoreAIKey ? "仅写入，不回显" : "开发模式下 Key 在 engine/.env 配置",
);

const resultLines = computed(() => {
	const r = testResult.value;
	if (!r) return null;
	if (!r.ok) return { ok: false as const, text: r.error ?? "连接失败", warn: "" };
	const parts = [
		"连接正常",
		r.seesImage === false ? "不能看图" : "能看图",
		r.structuredMode ? TIER_TEXT[r.structuredMode] : "",
		`${(r.latencyMs / 1000).toFixed(1)} 秒`,
	].filter(Boolean);
	return {
		ok: true as const,
		text: parts.join(" · "),
		warn: r.seesImage === false ? "该模型无法识别图片，不适合本应用" : "",
	};
});

function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

async function clearKey(): Promise<void> {
	if (!normalized.value.ok || busy.value) return;
	busy.value = "clear";
	errorText.value = "";
	try {
		const r = await store.setKey(normalized.value.baseUrl, null);
		if (!r.persisted) message.warning("Key 未能保存到系统钥匙串，重启后需重填");
	} catch (e) {
		errorText.value = errMsg(e);
	} finally {
		busy.value = null;
	}
}

/** 保存；成功返回 true。失败把原因写进对话框，表单保持原样。 */
async function persist(): Promise<boolean> {
	const n = normalized.value;
	if (!n.ok) return false;
	errorText.value = "";
	try {
		if (canStoreAIKey && apiKey.value !== "") {
			const r = await store.setKey(n.baseUrl, apiKey.value);
			apiKey.value = "";
			if (!r.persisted) message.warning("Key 未能保存到系统钥匙串，重启后需重填");
		}
		await store.save({
			baseUrl: n.baseUrl,
			model: model.value.trim(),
			imageSource: imageSource.value,
		});
		// 引擎返回的才是生效值，回填一次让表单与之一致。
		baseUrl.value = store.settings?.baseUrl ?? n.baseUrl;
		return true;
	} catch (e) {
		errorText.value = errMsg(e);
		return false;
	}
}

async function onSave(): Promise<void> {
	if (!canSubmit.value) return;
	busy.value = "save";
	testResult.value = null;
	try {
		if (await persist()) {
			message.success("已保存");
			emit("update:show", false);
		}
	} finally {
		busy.value = null;
	}
}

async function onSaveAndTest(): Promise<void> {
	if (!canSubmit.value) return;
	busy.value = "test";
	testResult.value = null;
	try {
		if (!(await persist())) return;
		testResult.value = await store.test();
	} catch (e) {
		errorText.value = errMsg(e);
	} finally {
		busy.value = null;
	}
}
</script>

<template>
	<n-modal
		:show="show"
		preset="card"
		title="模型服务"
		closable
		style="width: 560px; max-width: 92vw"
		:mask-closable="busy === null"
		:close-on-esc="busy === null"
		@update:show="onShowUpdate">
		<n-form
			label-placement="left"
			label-width="84"
			@submit.prevent>
			<n-form-item label="服务">
				<n-select
					:value="preset"
					:options="SERVICE_OPTIONS"
					@update:value="onPresetChange" />
			</n-form-item>
			<n-form-item
				label="接口地址"
				:validation-status="urlError ? 'error' : undefined"
				:feedback="urlError || undefined">
				<n-input
					:value="baseUrl"
					@update:value="onUrlInput"
					:readonly="preset !== CUSTOM"
					placeholder="https://…/v1"
					autocomplete="off" />
			</n-form-item>
			<n-form-item label="API Key">
				<n-input
					:value="apiKey"
					@update:value="onKeyInput"
					type="password"
					autocomplete="off"
					:disabled="!canStoreAIKey"
					:placeholder="keyPlaceholder" />
				<n-text
					depth="3"
					class="key-status">
					<template v-if="keyStatus === 'env'">来自 engine/.env</template>
					<template v-else-if="keyStatus === 'saved'">
						已保存
						<!-- 只有表里的 Key 能清除；纯 Web 模式没有主进程可写，不给按钮 -->
						<n-button
							v-if="canStoreAIKey"
							text
							type="primary"
							size="small"
							:loading="busy === 'clear'"
							:disabled="busy !== null"
							@click="clearKey">
							清除
						</n-button>
					</template>
					<template v-else>未设置</template>
				</n-text>
			</n-form-item>
			<n-form-item
				label="模型"
				:validation-status="modelEmpty ? 'error' : undefined"
				:feedback="modelEmpty ? '模型不能为空' : undefined">
				<n-input
					:value="model"
					@update:value="onModelInput"
					autocomplete="off" />
			</n-form-item>
			<n-form-item label="喂图方式">
				<n-radio-group
					:value="imageSource"
					@update:value="onImageSourceChange">
					<n-space>
						<n-radio value="grids">宫格图</n-radio>
						<n-radio value="frames">单帧（更准，费用更高）</n-radio>
					</n-space>
				</n-radio-group>
			</n-form-item>
		</n-form>

		<n-alert
			v-if="errorText"
			type="error"
			:show-icon="false">
			{{ errorText }}
		</n-alert>
		<template v-if="resultLines">
			<n-alert
				:type="resultLines.ok ? 'success' : 'error'"
				:show-icon="false">
				{{ resultLines.ok ? "✓ " : "" }}{{ resultLines.text }}
			</n-alert>
			<n-alert
				v-if="resultLines.warn"
				type="warning"
				:show-icon="false"
				class="result-warn">
				{{ resultLines.warn }}
			</n-alert>
		</template>

		<template #footer>
			<n-space justify="end">
				<n-button
					:loading="busy === 'save'"
					:disabled="!canSubmit"
					@click="onSave">
					仅保存
				</n-button>
				<n-button
					type="primary"
					:loading="busy === 'test'"
					:disabled="!canSubmit"
					@click="onSaveAndTest">
					保存并测试
				</n-button>
			</n-space>
		</template>
	</n-modal>
</template>

<style scoped>
.key-status {
	margin-left: 10px;
	white-space: nowrap;
	font-size: 12px;
}
.result-warn {
	margin-top: 8px;
}
</style>
