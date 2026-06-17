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

const summary = computed(() => {
  const m = model.value;
  return [
    `${m.quality}p`,
    m.mode,
    m.browser || "无 cookie",
    m.dedup ? `去重·阈值${m.threshold ?? DEFAULTS.dedupThreshold}` : "不去重",
  ].join(" · ");
});
</script>

<template>
  <n-collapse>
    <n-collapse-item name="adv">
      <template #header>
        <span class="adv-header">高级选项</span>
      </template>
      <template #header-extra>
        <span class="adv-summary">{{ summary }}</span>
      </template>
      <n-form label-placement="left" label-width="120" :show-feedback="false">
        <n-form-item label="画质">
          <n-select v-model:value="model.quality" :options="qualityOptions" style="width: 160px" />
        </n-form-item>
        <n-form-item label="模式">
          <n-select v-model:value="model.mode" :options="modeOptions" style="width: 220px" />
        </n-form-item>
        <n-form-item label="下载 cookie">
          <n-select v-model:value="model.browser" :options="browserOptions" style="width: 220px" />
        </n-form-item>
        <n-form-item label="去重选代表帧">
          <n-switch v-model:value="model.dedup" />
        </n-form-item>
        <n-form-item v-if="model.dedup" label="去重阈值">
          <n-input-number v-model:value="model.threshold" :min="0" :max="64" style="width: 120px" />
        </n-form-item>
      </n-form>
    </n-collapse-item>
  </n-collapse>
</template>

<style scoped>
.adv-header {
  font-size: 13px;
}
.adv-summary {
  font-size: 12px;
  color: #9aa3b2;
}
</style>
