<script setup lang="ts">
/**
 * 换图：逐秒帧网格。去重代表帧描边，当前页配图高亮；点击选帧 → emit pick(timestamp)。
 * 帧清单经 api/ 层（typed）拉取，组件不裸 fetch。
 */
import { onMounted, ref } from "vue";
import type { Frame, Timestamp } from "@shared/types";
import { api } from "../api/client";

const props = defineProps<{ taskId: string; current: Timestamp }>();
const emit = defineEmits<{ pick: [image: Timestamp]; close: [] }>();

const frames = ref<Frame[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const onlyRepresentative = ref(true);

onMounted(async () => {
  try {
    frames.value = await api.listFrames(props.taskId);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
});

function shown(): Frame[] {
  return onlyRepresentative.value ? frames.value.filter((f) => f.isRepresentative) : frames.value;
}
</script>

<template>
  <div class="picker">
    <div class="picker-bar">
      <span class="picker-title">选择配图 · 共 {{ frames.length }} 帧</span>
      <n-space align="center" :size="10">
        <n-checkbox v-model:checked="onlyRepresentative">仅代表帧</n-checkbox>
        <n-button size="tiny" quaternary @click="emit('close')">收起</n-button>
      </n-space>
    </div>

    <n-spin :show="loading">
      <p v-if="error" class="picker-error">{{ error }}</p>
      <div v-else class="grid">
        <button
          v-for="f in shown()"
          :key="f.timestamp"
          type="button"
          class="cell"
          :class="{ rep: f.isRepresentative, current: f.timestamp === current }"
          @click="emit('pick', f.timestamp)"
        >
          <img :src="api.hdUrl(taskId, f.timestamp)" :alt="f.timestamp" loading="lazy" />
          <span class="ts">{{ f.timestamp }}</span>
        </button>
      </div>
    </n-spin>
  </div>
</template>

<style scoped>
.picker {
  margin-top: 12px;
  border-top: 1px solid var(--n-border-color, #2a2f3a);
  padding-top: 12px;
}
.picker-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.picker-title {
  font-size: 12px;
  color: #9aa3b2;
}
.picker-error {
  color: #f85149;
  font-size: 13px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
  max-height: 420px;
  overflow: auto;
}
.cell {
  position: relative;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  background: none;
  line-height: 0;
}
.cell img {
  width: 100%;
  display: block;
}
.cell.rep {
  border-color: #d29922; /* 去重代表帧描边 */
}
.cell.current {
  border-color: #5b9dff; /* 当前页配图 */
}
.cell:hover {
  outline: 2px solid #5b9dff;
}
.ts {
  position: absolute;
  left: 3px;
  bottom: 3px;
  font-size: 10px;
  font-family: ui-monospace, Menlo, monospace;
  background: rgba(0, 0, 0, 0.6);
  padding: 0 4px;
  border-radius: 3px;
  line-height: 1.4;
}
</style>
