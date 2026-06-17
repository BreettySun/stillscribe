<script setup lang="ts">
/** 高级选项：画质/模式/cookie/去重/阈值。默认折叠，折叠头显示摘要。 */
import { computed } from "vue";
import {
	DEFAULTS,
	type ArticleMode,
	type CookieBrowser,
	type VideoQuality,
} from "@shared/types";

export interface AdvancedModel {
	quality: VideoQuality;
	mode: ArticleMode;
	browser: CookieBrowser | "";
	dedup: boolean;
	threshold: number | null;
}

const model = defineModel<AdvancedModel>({ required: true });

const BROWSERS: CookieBrowser[] = [
	"chrome",
	"safari",
	"edge",
	"firefox",
	"brave",
	"chromium",
	"opera",
	"vivaldi",
];
const browserOptions = [
	{ label: "不带 cookie", value: "" },
	...BROWSERS.map((b) => ({ label: b, value: b })),
];
const qualityOptions = [
	{ label: "1080p", value: 1080 },
	{ label: "1440p", value: 1440 },
];
const modeOptions = [{ label: "semi（半自动回填）", value: "semi" }];

const summaryTags = computed(() => {
	const m = model.value;
	return [
		`${m.quality}p`,
		m.mode,
		m.browser || "无 cookie",
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
					:cols="4"
					:x-gap="16"
					:y-gap="12"
					responsive="screen"
					item-responsive>
					<n-form-item-gi
						label="画质"
						:span="2">
						<n-select
							v-model:value="model.quality"
							:options="qualityOptions" />
					</n-form-item-gi>
					<n-form-item-gi
						label="模式"
						:span="2">
						<n-select
							v-model:value="model.mode"
							:options="modeOptions" />
					</n-form-item-gi>
					<n-form-item-gi
						label="下载 cookie"
						:span="2">
						<n-select
							v-model:value="model.browser"
							:options="browserOptions" />
					</n-form-item-gi>
					<n-form-item-gi
						label="相近帧去重"
						:span="1">
						<n-switch v-model:value="model.dedup" />
					</n-form-item-gi>
					<n-form-item-gi
						v-if="model.dedup"
						label="去重阈值"
						:span="1">
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
.adv-header {
	font-size: 13px;
}
</style>
