<script setup lang="ts">
/** 半自动：粘贴符合 Article 契约的 JSON 回填。仅做 JSON 语法校验，结构校验交给引擎。 */
import { computed, ref } from "vue";
import type { Article } from "@shared/types";

const emit = defineEmits<{ save: [article: Article] }>();
const props = defineProps<{ busy?: boolean; serverError?: string | null }>();

const SKELETON = JSON.stringify(
  {
    pages: [{ subhead: "Grand Entrance", image: "00_01_23", body: "Two to four sentences." }],
    meta: { titles: ["Title A", "Title B"], keywords: ["k1", "k2"], description: "2-3 sentences." },
    notes: { imageRationale: "中文配图思路（仅参考，不进 docx）" },
  },
  null,
  2,
);

const text = ref("");

const parseError = computed<string | null>(() => {
  if (!text.value.trim()) return null;
  try {
    JSON.parse(text.value);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "JSON 解析失败";
  }
});

function onSave(): void {
  if (parseError.value || !text.value.trim()) return;
  emit("save", JSON.parse(text.value) as Article);
}
</script>

<template>
  <n-space vertical :size="10">
    <n-input
      v-model:value="text"
      type="textarea"
      :rows="12"
      placeholder="粘贴符合 Article 契约的 JSON…"
    />
    <n-alert v-if="parseError" type="error" :show-icon="false">JSON 语法错误：{{ parseError }}</n-alert>
    <n-alert v-if="props.serverError" type="error" :show-icon="false">
      引擎校验：{{ props.serverError }}
    </n-alert>
    <n-space>
      <n-button
        type="primary"
        :disabled="!text.trim() || !!parseError"
        :loading="props.busy"
        @click="onSave"
      >
        保存文章
      </n-button>
      <n-button tertiary @click="text = SKELETON">填入示例骨架</n-button>
    </n-space>
  </n-space>
</template>
