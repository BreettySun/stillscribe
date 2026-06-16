<script setup lang="ts">
import type { Article, Task } from "@shared/types";
import { api } from "../api/client";

const props = defineProps<{ task: Task; article: Article }>();

function paragraphs(body: string): string[] {
  return body
    .split("\n\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
</script>

<template>
  <section class="panel">
    <h2>文章预览（{{ article.pages.length }} 页）</h2>
    <article v-for="(page, i) in article.pages" :key="i" class="page">
      <h3>{{ page.subhead }}</h3>
      <img :src="api.hdUrl(task.id, page.image)" :alt="page.image" class="page-img" />
      <p class="muted mono">配图: {{ page.image }}</p>
      <p v-for="(para, j) in paragraphs(page.body)" :key="j">{{ para }}</p>
    </article>

    <div class="meta">
      <h3>Meta</h3>
      <p><strong>Titles:</strong> {{ article.meta.titles.join(" | ") }}</p>
      <p><strong>Keywords:</strong> {{ article.meta.keywords.join(", ") }}</p>
      <p><strong>Description:</strong> {{ article.meta.description }}</p>
    </div>

    <details v-if="article.notes" class="notes">
      <summary>说明 / CoT（仅参考 · 不进 docx）</summary>
      <p v-if="article.notes.frameworkRationale">{{ article.notes.frameworkRationale }}</p>
      <p v-if="article.notes.imageRationale">{{ article.notes.imageRationale }}</p>
    </details>
  </section>
</template>

<style scoped>
.page { border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 12px; }
.page-img { max-width: 480px; width: 100%; border: 1px solid var(--border); border-radius: var(--radius); }
.notes { margin-top: 12px; color: var(--warn); }
.notes summary { cursor: pointer; }
.notes p { color: var(--muted); }
</style>
