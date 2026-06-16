<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { RouterLink, RouterView } from "vue-router";
import { useTasksStore } from "./stores/tasks";
import { connectEvents } from "./api/events";

const store = useTasksStore();
let disconnect: (() => void) | undefined;

onMounted(async () => {
  await store.fetchAll();
  disconnect = connectEvents((e) => store.applyEvent(e));
});
onUnmounted(() => disconnect?.());
</script>

<template>
  <nav class="app-nav">
    <h1>diggo-press</h1>
    <RouterLink to="/">提交 / 队列</RouterLink>
    <span class="muted">YouTube 视频 → 图文文章</span>
  </nav>
  <main class="app-main">
    <RouterView />
  </main>
</template>
