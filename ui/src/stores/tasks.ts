/**
 * 任务状态（Pinia）：引擎是权威，本 store 只做镜像 + SSE 增量更新。
 * 不用 localStorage 持久化（CLAUDE.md 铁律 #9）。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  Article,
  BatchSubmit,
  EngineEvent,
  StepProgress,
  SwapImageRequest,
  Task,
  TaskId,
  TaskParams,
} from "@shared/types";
import { api } from "../api/client";
import { notify } from "../bridge";

export const useTasksStore = defineStore("tasks", () => {
  const byId = ref<Record<TaskId, Task>>({});
  /** 各任务最近一条进度（不属于 Task 快照，单独存供实时展示）。 */
  const progress = ref<Record<TaskId, StepProgress>>({});

  const list = computed(() =>
    Object.values(byId.value).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  );

  function upsert(t: Task): void {
    byId.value[t.id] = t;
  }
  function patch(id: TaskId, p: Partial<Task>): void {
    const cur = byId.value[id];
    if (cur) byId.value[id] = { ...cur, ...p };
  }
  function titleOf(id: TaskId): string {
    const t = byId.value[id];
    return t?.videoTitle ?? t?.params.url ?? id;
  }

  async function fetchAll(): Promise<void> {
    for (const t of await api.listTasks()) upsert(t);
  }
  async function refresh(id: TaskId): Promise<void> {
    upsert(await api.getTask(id));
  }

  function applyEvent(e: EngineEvent): void {
    switch (e.type) {
      case "task_created":
        upsert(e.task);
        break;
      case "status_changed":
        patch(e.taskId, { status: e.status });
        break;
      case "progress":
        progress.value[e.taskId] = e.progress;
        patch(e.taskId, { currentStep: e.progress.step });
        break;
      case "awaiting_review":
        patch(e.taskId, { status: "awaiting_review", article: e.article });
        break;
      case "completed":
        patch(e.taskId, { status: "completed", outputDocx: e.outputDocx });
        notify("任务完成", titleOf(e.taskId));
        break;
      case "failed":
        patch(e.taskId, { status: "failed", error: e.error });
        notify("任务失败", `${titleOf(e.taskId)}：${e.error}`);
        break;
    }
  }

  async function submit(params: TaskParams[]): Promise<TaskId[]> {
    const body: TaskParams | BatchSubmit = params.length === 1 ? params[0]! : { tasks: params };
    const { ids } = await api.submit(body);
    // 乐观刷新：即使 SSE 偶发断连/重连有空窗，也保证新任务立即可见。
    await Promise.all(ids.map((id) => refresh(id).catch(() => {})));
    return ids;
  }

  async function cancel(id: TaskId): Promise<void> {
    upsert(await api.cancel(id));
  }
  async function saveArticle(id: TaskId, article: Article): Promise<void> {
    upsert(await api.saveArticle(id, article));
  }
  async function swap(id: TaskId, req: SwapImageRequest): Promise<void> {
    upsert(await api.swap(id, req));
  }
  async function exportDocx(id: TaskId): Promise<string> {
    const { docxPath } = await api.exportDocx(id);
    await refresh(id);
    return docxPath;
  }

  return {
    byId,
    progress,
    list,
    fetchAll,
    refresh,
    applyEvent,
    submit,
    cancel,
    saveArticle,
    swap,
    exportDocx,
  };
});
