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
import { notify, refreshCookies } from "../bridge";
import { useSettingsStore } from "./settings";

/** yt-dlp 撞 YouTube 登录验证的特征（引擎把 stderr 尾部存进 task.error）。 */
function isBotCheck(msg?: string): boolean {
	return (
		!!msg &&
		/not a bot|Sign in to confirm|--cookies-from-browser|--cookies\b/i.test(msg)
	);
}

export const useTasksStore = defineStore("tasks", () => {
	const byId = ref<Record<TaskId, Task>>({});
	/** 各任务最近一条进度（不属于 Task 快照，单独存供实时展示）。 */
	const progress = ref<Record<TaskId, StepProgress>>({});
	/** 当前选中的任务 —— 取代 vue-router，驱动右栏 master-detail（文档 §5，仅内存不持久化）。 */
	const selectedId = ref<TaskId | null>(null);

	const list = computed(() =>
		Object.values(byId.value).sort((a, b) =>
			a.createdAt.localeCompare(b.createdAt),
		),
	);

	const selected = computed<Task | null>(() =>
		selectedId.value ? (byId.value[selectedId.value] ?? null) : null,
	);

	function setSelected(id: TaskId | null): void {
		selectedId.value = id;
	}

	function upsert(t: Task): void {
		byId.value[t.id] = t;
	}
	function patch(id: TaskId, p: Partial<Task>): void {
		const cur = byId.value[id];
		if (cur) byId.value[id] = { ...cur, ...p };
	}
	function drop(id: TaskId): void {
		delete byId.value[id];
		delete progress.value[id];
		if (selectedId.value === id) selectedId.value = null;
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
			case "info":
				patch(e.taskId, { videoTitle: e.videoTitle, workDir: e.workDir });
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
				if (isBotCheck(e.error)) {
					void autoRefreshAndRetry(e.taskId);
				} else {
					notify("任务失败", `${titleOf(e.taskId)}：${e.error}`);
				}
				break;
			case "task_deleted":
				drop(e.taskId);
				break;
		}
	}

	async function submit(params: TaskParams[]): Promise<TaskId[]> {
		const body: TaskParams | BatchSubmit =
			params.length === 1 ? params[0]! : { tasks: params };
		const { ids } = await api.submit(body);
		// 乐观刷新：即使 SSE 偶发断连/重连有空窗，也保证新任务立即可见。
		await Promise.all(ids.map((id) => refresh(id).catch(() => {})));
		return ids;
	}

	async function cancel(id: TaskId): Promise<void> {
		upsert(await api.cancel(id));
	}
	async function retry(id: TaskId): Promise<void> {
		upsert(await api.retry(id));
	}

	// 自动刷新 cookie + 重试：按 url 去重避免无限循环；批量同时失败只刷一次。
	const autoHandledUrls = new Set<string>();
	let refreshing: Promise<{ kept: number }> | null = null;
	async function autoRefreshAndRetry(id: TaskId): Promise<void> {
		const task = byId.value[id];
		if (!task) return;
		const url = task.params.url;
		if (autoHandledUrls.has(url)) {
			// 刷新过仍失败：不再自动重试，提示用户人工处理。
			notify(
				"任务失败",
				`${titleOf(id)}：刷新 Cookie 后仍需登录验证，请检查浏览器是否已登录 YouTube`,
			);
			return;
		}
		autoHandledUrls.add(url);
		const browser = useSettingsStore().cookieBrowser;
		notify("正在刷新 Cookie", `检测到登录验证，正用 ${browser} 刷新并重试…`);
		try {
			refreshing ??= refreshCookies(browser);
			await refreshing;
			await retry(id);
		} catch (e) {
			notify("Cookie 刷新失败", e instanceof Error ? e.message : String(e));
		} finally {
			refreshing = null;
		}
	}
	async function remove(id: TaskId): Promise<void> {
		await api.remove(id);
		drop(id); // 乐观移除；SSE 的 task_deleted 再次 drop 也幂等。
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
		selectedId,
		selected,
		list,
		setSelected,
		titleOf,
		fetchAll,
		refresh,
		applyEvent,
		submit,
		cancel,
		retry,
		remove,
		saveArticle,
		swap,
		exportDocx,
	};
});
