<script setup lang="ts">
import { RouterLink } from "vue-router";
import type { Task } from "@shared/types";

defineProps<{ task: Task }>();
</script>

<template>
  <RouterLink :to="`/tasks/${task.id}`" class="task-item">
    <div class="task-main">
      <div class="task-title">{{ task.videoTitle ?? task.params.url }}</div>
      <div class="muted mono">{{ task.params.url }}</div>
    </div>
    <div class="task-meta">
      <span class="badge" :class="task.status">{{ task.status }}</span>
      <span class="muted" v-if="task.currentStep">· {{ task.currentStep }}</span>
    </div>
  </RouterLink>
</template>

<style scoped>
.task-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 8px;
  color: var(--text);
}
.task-item:hover { background: var(--panel-2); text-decoration: none; }
.task-main { min-width: 0; }
.task-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-meta { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
</style>
