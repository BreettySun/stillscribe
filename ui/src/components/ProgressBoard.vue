<script setup lang="ts">
import { computed } from "vue";
import type { PipelineStep, StepProgress, Task } from "@shared/types";

const props = defineProps<{ task: Task; progress?: StepProgress }>();
const emit = defineEmits<{ cancel: [] }>();

const STEPS: { key: PipelineStep; label: string }[] = [
  { key: "download", label: "下载" },
  { key: "frames", label: "抽帧" },
  { key: "dedup", label: "去重" },
  { key: "grids", label: "宫格图" },
  { key: "docx", label: "生成 docx" },
];
const ORDER = STEPS.map((s) => s.key);

function stepState(key: PipelineStep): "done" | "active" | "pending" {
  const t = props.task;
  if (t.status === "completed") return "done";
  if (t.status === "awaiting_review") {
    return ORDER.indexOf(key) < ORDER.indexOf("docx") ? "done" : "pending";
  }
  const ci = t.currentStep ? ORDER.indexOf(t.currentStep) : -1;
  const ki = ORDER.indexOf(key);
  if (ci < 0) return "pending";
  if (ki < ci) return "done";
  if (ki === ci) return "active";
  return "pending";
}

const cancelable = computed(() => props.task.status === "running" || props.task.status === "queued");
</script>

<template>
  <section class="panel">
    <div class="row" style="justify-content: space-between">
      <h2>{{ task.videoTitle ?? "（标题待解析）" }}</h2>
      <span class="badge" :class="task.status">{{ task.status }}</span>
    </div>

    <ol class="steps">
      <li v-for="s in STEPS" :key="s.key" :class="stepState(s.key)">
        <span class="dot" />{{ s.label }}
      </li>
    </ol>

    <p v-if="progress?.message" class="muted">{{ progress.message }}</p>
    <p v-if="task.status === 'failed'" class="badge failed">{{ task.error }}</p>

    <button v-if="cancelable" class="danger" @click="emit('cancel')">取消任务</button>
  </section>
</template>

<style scoped>
.steps { list-style: none; padding: 0; display: flex; gap: 18px; flex-wrap: wrap; }
.steps li { display: flex; align-items: center; gap: 6px; color: var(--muted); }
.steps .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--border); }
.steps li.done { color: var(--ok); }
.steps li.done .dot { background: var(--ok); }
.steps li.active { color: var(--accent); }
.steps li.active .dot { background: var(--accent); animation: pulse 1s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
