<script setup lang="ts">
import { computed, ref } from "vue";
import { DEFAULTS, type CookieBrowser, type TaskParams, type VideoQuality } from "@shared/types";

const emit = defineEmits<{ submit: [params: TaskParams[]] }>();
defineProps<{ busy?: boolean }>();

const BROWSERS: CookieBrowser[] = ["chrome", "safari", "edge", "firefox", "brave", "chromium", "opera", "vivaldi"];

const urlsText = ref("");
const quality = ref<VideoQuality>(DEFAULTS.quality);
const dedup = ref(DEFAULTS.dedup);
const mode = ref(DEFAULTS.mode); // 本版仅 semi（半自动回填）
const threshold = ref<number | null>(DEFAULTS.dedupThreshold);
// YouTube 常需登录验证，默认带 chrome cookie；选"不带"则不传 --cookies-from-browser。
const browser = ref<CookieBrowser | "">("chrome");

const urls = computed(() =>
  urlsText.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean),
);

function onSubmit(): void {
  if (urls.value.length === 0) return;
  const params: TaskParams[] = urls.value.map((url) => ({
    url,
    quality: quality.value,
    dedup: dedup.value,
    ...(dedup.value && threshold.value != null ? { dedupThreshold: threshold.value } : {}),
    mode: mode.value,
    ...(browser.value ? { browser: browser.value } : {}),
  }));
  emit("submit", params);
  urlsText.value = "";
}
</script>

<template>
  <section class="panel">
    <h2>提交任务</h2>
    <div class="field">
      <label>YouTube URL（每行一个，可批量，单批 ≤ {{ DEFAULTS.maxBatchSize }}）</label>
      <textarea v-model="urlsText" rows="4" placeholder="https://www.youtube.com/watch?v=..." />
    </div>
    <div class="row" style="margin-top: 12px">
      <div class="field">
        <label>画质</label>
        <select v-model.number="quality">
          <option :value="1080">1080p</option>
          <option :value="1440">1440p</option>
        </select>
      </div>
      <div class="field">
        <label>模式</label>
        <select v-model="mode">
          <option value="semi">semi（半自动回填）</option>
        </select>
      </div>
      <div class="field">
        <label>下载 cookie（YouTube 登录验证用）</label>
        <select v-model="browser">
          <option value="">不带 cookie</option>
          <option v-for="b in BROWSERS" :key="b" :value="b">{{ b }}</option>
        </select>
      </div>
      <div class="field">
        <label><input type="checkbox" v-model="dedup" /> 去重选代表帧</label>
      </div>
      <div class="field" v-if="dedup">
        <label>去重阈值（phash 汉明距离）</label>
        <input type="number" v-model.number="threshold" min="0" max="64" style="width: 90px" />
      </div>
    </div>
    <div class="row" style="margin-top: 14px">
      <button :disabled="urls.length === 0 || busy" @click="onSubmit">
        提交 {{ urls.length > 1 ? `${urls.length} 个` : "" }}任务
      </button>
      <span class="muted" v-if="urls.length > 1">将作为一批提交</span>
    </div>
  </section>
</template>
