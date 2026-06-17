<script setup lang="ts">
/** 新建任务态（无选中）：URL 主输入 + 折叠的高级选项 + 提交 CTA。 */
import { computed, reactive, ref } from "vue";
import { useMessage } from "naive-ui";
import { DEFAULTS, type TaskParams } from "@shared/types";
import { useTasksStore } from "../stores/tasks";
import AdvancedOptions, { type AdvancedModel } from "./AdvancedOptions.vue";

const store = useTasksStore();
const message = useMessage();

const urlsText = ref("");
const busy = ref(false);

const adv = reactive<AdvancedModel>({
  quality: DEFAULTS.quality,
  mode: DEFAULTS.mode,
  browser: "chrome", // YouTube 常需登录验证，默认带 chrome cookie。
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
  const params: TaskParams[] = urls.value.map((url) => ({
    url,
    quality: adv.quality,
    dedup: adv.dedup,
    ...(adv.dedup && adv.threshold != null ? { dedupThreshold: adv.threshold } : {}),
    mode: adv.mode,
    ...(adv.browser ? { browser: adv.browser } : {}),
  }));
  busy.value = true;
  try {
    const ids = await store.submit(params);
    urlsText.value = "";
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
  <n-space vertical :size="18">
    <div>
      <h2 class="form-title">新建任务</h2>
      <p class="form-hint">YouTube URL（每行一个，单批 ≤ {{ DEFAULTS.maxBatchSize }}）</p>
    </div>

    <n-input
      v-model:value="urlsText"
      type="textarea"
      :rows="5"
      placeholder="https://www.youtube.com/watch?v=..."
      :autosize="{ minRows: 5 }"
    />

    <n-space align="center">
      <n-button
        type="primary"
        size="large"
        :disabled="urls.length === 0"
        :loading="busy"
        @click="onSubmit"
      >
        ▶ 提交{{ urls.length > 1 ? ` ${urls.length} 个` : "" }}任务
      </n-button>
      <span class="form-hint">默认即可开始</span>
    </n-space>

    <AdvancedOptions v-model="adv" />
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
  color: #9aa3b2;
}
</style>
