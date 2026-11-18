<script setup lang="ts">
/** 高级选项：画质/模式/去重/阈值。默认折叠，折叠头显示摘要。
 * cookie 来源统一由标题栏「Cookie 来源」全局设置控制（不在此重复）。 */
import { computed } from "vue";
import { DEFAULTS, type ArticleMode, type VideoQuality } from "@shared/types";

export interface AdvancedModel {
	quality: VideoQuality;
	mode: ArticleMode;
	dedup: boolean;
	threshold: number | null;
}

const model = defineModel<AdvancedModel>({ required: true });

const props = withDefaults(defineProps<{ aiReady?: boolean }>(), {
	aiReady: false,
});

const qualityOptions = [
	{ label: "1080p", value: 1080 },
	{ label: "1440p", value: 1440 },
];
// auto 需先在设置中配好模型服务（地址 + Key）才可选；未配置时禁用并提示。
const modeOptions = computed(() => [
	{
		label: "Auto（全自动）",
		value: "auto",
		disabled: !props.aiReady,
	},
	{ label: "Semi（半自动回填）", value: "semi" },
]);

const summaryTags = computed(() => {
	const m = model.value;
	return [
		`${m.quality}p`,
		m.mode,
		m.dedup ? `去重·阈值${m.threshold ?? DEFAULTS.dedupThreshold}` : "不去重",
	];
});
</script>

<template>
	<n-collapse>
		<n-collapse-item name="adv">
			<template #header>
				<span class="adv-header">高级选项</span>
			</template>
			<template #header-extra>
				<n-flex :size="6">
					<n-tag
						v-for="t in summaryTags"
						:key="t"
						size="small"
						:bordered="false">
						{{ t }}
					</n-tag>
				</n-flex>
			</template>
			<n-form
				label-placement="top"
				:show-feedback="false">
				<n-grid
					:cols="6"
					:x-gap="16"
					:y-gap="20"
					responsive="screen"
					item-responsive>
					<n-form-item-gi
						label="画质"
						:span="3">
						<n-select
							v-model:value="model.quality"
							:options="qualityOptions" />
					</n-form-item-gi>
					<n-form-item-gi
						label="模式"
						:span="3">
						<n-select
							v-model:value="model.mode"
							:options="modeOptions" />
						<span
							v-if="!aiReady"
							class="mode-hint">
							请先在设置中配置模型服务
						</span>
					</n-form-item-gi>
					<n-form-item-gi
						label="相近帧去重"
						:span="1">
						<n-switch v-model:value="model.dedup" />
					</n-form-item-gi>
					<n-form-item-gi
						v-if="model.dedup"
						label="去重阈值"
						:span="2">
						<n-input-number
							v-model:value="model.threshold"
							:min="0"
							:max="64"
							style="width: 100%" />
					</n-form-item-gi>
				</n-grid>
			</n-form>
		</n-collapse-item>
	</n-collapse>
</template>

<style scoped>
.mode-hint {
	margin-left: 8px;
	font-size: 12px;
	color: var(--c-muted);
}
.adv-header {
	font-size: 13px;
}
</style>
