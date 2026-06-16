<script setup lang="ts">
import { api } from "../api/client";

defineProps<{ taskId: string; files: string[] }>();
</script>

<template>
  <section class="panel">
    <h2>宫格图（{{ files.length }}）</h2>
    <p class="muted">
      半自动：把这些宫格图 + 字幕交给网页版 Gemini，按 Article 契约生成 JSON，粘贴到下方回填框。
    </p>
    <div class="grids">
      <a v-for="f in files" :key="f" :href="api.gridUrl(taskId, f)" target="_blank">
        <img :src="api.gridUrl(taskId, f)" :alt="f" loading="lazy" />
        <span class="muted mono">{{ f }}</span>
      </a>
    </div>
  </section>
</template>

<style scoped>
.grids { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.grids a { display: block; color: var(--text); }
.grids img { width: 100%; border: 1px solid var(--border); border-radius: var(--radius); display: block; }
</style>
