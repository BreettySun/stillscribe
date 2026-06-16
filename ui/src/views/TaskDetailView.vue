<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import type { Article } from "@shared/types";
import { useTasksStore } from "../stores/tasks";
import { api } from "../api/client";
import ProgressBoard from "../components/ProgressBoard.vue";
import GridStrip from "../components/GridStrip.vue";
import ArticleEditor from "../components/ArticleEditor.vue";
import ArticlePreview from "../components/ArticlePreview.vue";

const props = defineProps<{ id: string }>();
const store = useTasksStore();

const task = computed(() => store.byId[props.id]);
const progress = computed(() => store.progress[props.id]);

const grids = ref<string[]>([]);
const saveError = ref<string | null>(null);
const saving = ref(false);
const exportError = ref<string | null>(null);
const exporting = ref(false);

onMounted(() => {
  store.refresh(props.id).catch(() => {});
});

// 任务进入可校对阶段（grids 已出）后，拉宫格图清单供半自动回填。
watch(
  () => task.value?.status,
  async (status) => {
    if (status === "awaiting_review" || status === "completed") {
      try {
        grids.value = (await api.listGrids(props.id)).files;
      } catch {
        grids.value = [];
      }
    }
  },
  { immediate: true },
);

const showReview = computed(
  () =>
    task.value &&
    (task.value.status === "awaiting_review" || task.value.status === "completed" || !!task.value.article),
);
const showEditor = computed(
  () => task.value?.status === "awaiting_review" && task.value.params.mode === "semi",
);

async function onSaveArticle(article: Article): Promise<void> {
  saving.value = true;
  saveError.value = null;
  try {
    await store.saveArticle(props.id, article);
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}

async function onExport(): Promise<void> {
  exporting.value = true;
  exportError.value = null;
  try {
    await store.exportDocx(props.id);
  } catch (e) {
    exportError.value = e instanceof Error ? e.message : String(e);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div v-if="task">
    <RouterLink to="/">← 返回队列</RouterLink>
    <ProgressBoard :task="task" :progress="progress" @cancel="store.cancel(props.id)" />

    <template v-if="showReview">
      <GridStrip v-if="grids.length" :task-id="id" :files="grids" />
      <ArticleEditor
        v-if="showEditor"
        :busy="saving"
        :server-error="saveError"
        @save="onSaveArticle"
      />

      <template v-if="task.article">
        <ArticlePreview :task="task" :article="task.article" />
        <section class="panel">
          <h2>导出 docx</h2>
          <button :disabled="exporting" @click="onExport">
            {{ exporting ? "生成中…" : "生成 docx" }}
          </button>
          <p v-if="exportError" class="badge failed">{{ exportError }}</p>
          <p v-if="task.outputDocx" class="mono">✅ 已生成：{{ task.outputDocx }}</p>
        </section>
      </template>
    </template>
  </div>
  <p v-else class="muted">加载中…</p>
</template>
