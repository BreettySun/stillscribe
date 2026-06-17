<script setup lang="ts">
/** 单页：配图 + 小标题 + 正文摘要；点击配图/换图按钮进入帧选择。 */
import { computed } from "vue";
import type { ArticlePage, Task } from "@shared/types";
import { api } from "../api/client";

const props = defineProps<{ task: Task; page: ArticlePage; index: number; editing: boolean }>();
defineEmits<{ edit: [] }>();

const excerpt = computed(() => {
  const body = props.page.body.replace(/\s+/g, " ").trim();
  return body.length > 160 ? `${body.slice(0, 160)}…` : body;
});
</script>

<template>
  <n-card size="small" :class="{ editing }" class="page-card">
    <div class="page-row">
      <div class="page-img" :class="{ active: editing }" @click="$emit('edit')">
        <img :src="api.hdUrl(task.id, page.image)" :alt="page.image" loading="lazy" />
        <span class="img-ts">{{ page.image }}</span>
      </div>
      <div class="page-text">
        <div class="page-head">
          <span class="page-no">第 {{ index + 1 }} 页</span>
          <n-button size="tiny" :type="editing ? 'primary' : 'default'" tertiary @click="$emit('edit')">
            {{ editing ? "选择帧中…" : "换图" }}
          </n-button>
        </div>
        <h3 class="subhead">{{ page.subhead }}</h3>
        <p class="body">{{ excerpt }}</p>
      </div>
    </div>
    <slot name="picker" />
  </n-card>
</template>

<style scoped>
.page-card {
  margin-bottom: 12px;
}
.page-card.editing {
  border-color: #5b9dff;
}
.page-row {
  display: flex;
  gap: 14px;
}
.page-img {
  position: relative;
  width: 200px;
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
}
.page-img.active {
  border-color: #5b9dff;
}
.page-img img {
  width: 100%;
  display: block;
}
.img-ts {
  position: absolute;
  left: 4px;
  bottom: 4px;
  font-size: 11px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  background: rgba(0, 0, 0, 0.6);
  padding: 1px 5px;
  border-radius: 3px;
}
.page-text {
  min-width: 0;
  flex: 1;
}
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.page-no {
  font-size: 12px;
  color: #9aa3b2;
}
.subhead {
  margin: 6px 0;
  font-size: 15px;
}
.body {
  margin: 0;
  font-size: 13px;
  color: #c4c9d4;
  line-height: 1.5;
}
</style>
