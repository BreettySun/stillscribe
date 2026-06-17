<script setup lang="ts">
/** 选中任务详情：按 task.status 分发到 Progress / Review / Result 子视图。 */
import { computed } from "vue";
import type { Task } from "@shared/types";
import ProgressView from "./ProgressView.vue";
import ReviewView from "../review/ReviewView.vue";
import ResultView from "./ResultView.vue";

const props = defineProps<{ task: Task }>();

const view = computed<"progress" | "review" | "result">(() => {
  switch (props.task.status) {
    case "queued":
    case "running":
      return "progress";
    case "awaiting_review":
      return "review";
    default: // completed / failed / canceled
      return "result";
  }
});
</script>

<template>
  <ProgressView v-if="view === 'progress'" :task="task" />
  <ReviewView v-else-if="view === 'review'" :task="task" />
  <ResultView v-else :task="task" />
</template>
