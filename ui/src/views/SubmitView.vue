<script setup lang="ts">
import { computed, ref } from "vue";
import type { TaskParams } from "@shared/types";
import { useTasksStore } from "../stores/tasks";
import SubmitForm from "../components/SubmitForm.vue";
import TaskList from "../components/TaskList.vue";

const store = useTasksStore();
const busy = ref(false);
const error = ref<string | null>(null);

const tasks = computed(() => store.list);

async function onSubmit(params: TaskParams[]): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    await store.submit(params);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <SubmitForm :busy="busy" @submit="onSubmit" />
  <p v-if="error" class="badge failed">{{ error }}</p>
  <TaskList :tasks="tasks" />
</template>
