<script setup lang="ts">
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

/** 仅做 JSON 语法校验；结构校验交给引擎（唯一事实来源）。 */
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
  <section class="panel">
    <h2>回填文章 JSON（半自动）</h2>
    <textarea v-model="text" rows="14" placeholder="粘贴符合 Article 契约的 JSON…" />
    <p v-if="parseError" class="badge failed">JSON 语法错误：{{ parseError }}</p>
    <p v-if="props.serverError" class="badge failed">引擎校验：{{ props.serverError }}</p>
    <div class="row" style="margin-top: 12px">
      <button :disabled="!text.trim() || !!parseError || props.busy" @click="onSave">保存文章</button>
      <button class="ghost" @click="text = SKELETON">填入示例骨架</button>
    </div>
  </section>
</template>
