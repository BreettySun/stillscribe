<script setup lang="ts">
import type { Task } from "@shared/types";
import TaskListItem from "./TaskListItem.vue";

defineProps<{ tasks: Task[] }>();
</script>

<template>
  <section class="panel">
    <h2>任务队列（{{ tasks.length }}）</h2>
    <p class="muted" v-if="tasks.length === 0">还没有任务。提交一个 URL 开始。</p>
    <TaskListItem v-for="t in tasks" :key="t.id" :task="t" />
  </section>
</template>
