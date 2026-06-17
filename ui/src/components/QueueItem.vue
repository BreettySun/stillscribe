<script setup lang="ts">
/** 单条队列项：缩略图 + 标题 + 状态徽章 + 进度 + 状态操作。展示型，操作走 store。 */
import { computed } from "vue";
import type { Task, TaskStatus } from "@shared/types";
import { useTasksStore } from "../stores/tasks";
import { api } from "../api/client";
import { revealInFolder } from "../bridge";

const props = defineProps<{ task: Task; selected: boolean }>();
const store = useTasksStore();

const TAG_TYPE: Record<
	TaskStatus,
	"default" | "info" | "warning" | "success" | "error"
> = {
	queued: "default",
	running: "info",
	awaiting_review: "warning",
	completed: "success",
	failed: "error",
	canceled: "default",
};
const LABEL: Record<TaskStatus, string> = {
	queued: "排队中",
	running: "处理中",
	awaiting_review: "待校对",
	completed: "已完成",
	failed: "失败",
	canceled: "已取消",
};

const ratio = computed(() => store.progress[props.task.id]?.ratio);
const thumb = computed(() => {
	const img = props.task.article?.pages[0]?.image;
	return img ? api.hdUrl(props.task.id, img) : null;
});

function onCancel(): void {
	void store.cancel(props.task.id);
}
function onRetry(): void {
	void store.submit([props.task.params]);
}
function onOpen(): void {
	if (props.task.outputDocx) revealInFolder(props.task.outputDocx);
}
</script>

<template>
	<div
		class="item"
		:class="{ selected, attention: task.status === 'awaiting_review' }">
		<div class="thumb">
			<img
				v-if="thumb"
				:src="thumb"
				:alt="task.videoTitle"
				loading="lazy" />
			<div
				v-else
				class="thumb-ph" />
		</div>
		<div class="main">
			<div class="title">{{ task.videoTitle ?? task.params.url }}</div>
			<n-flex :size="8">
				<div class="sub">
					<n-tag
						:type="TAG_TYPE[task.status]"
						size="small"
						:bordered="false">
						{{ LABEL[task.status] }}
					</n-tag>
					<span
						v-if="task.status === 'running' && task.currentStep"
						class="step">
						· {{ task.currentStep }}
					</span>
				</div>
				<div
					class="actions"
					@click.stop>
					<n-button
						v-if="task.status === 'running' || task.status === 'queued'"
						size="tiny"
						quaternary
						@click="onCancel">
						取消
					</n-button>
					<n-button
						v-if="task.status === 'failed'"
						size="tiny"
						quaternary
						@click="onRetry">
						重试
					</n-button>
					<n-button
						v-if="task.status === 'completed' && task.outputDocx"
						size="tiny"
						@click="onOpen">
						打开 docx
					</n-button>
				</div>
			</n-flex>

			<n-progress
				v-if="task.status === 'running'"
				type="line"
				:percentage="ratio != null ? Math.round(ratio * 100) : 0"
				:processing="ratio == null"
				:show-indicator="false"
				:height="4"
				style="margin-top: 6px" />
		</div>
	</div>
</template>

<style scoped>
.item {
	display: flex;
	gap: 10px;
	padding: 10px 12px;
	cursor: pointer;
	border-left: 2px solid transparent;
	align-items: center;
}
.item:hover {
	background: var(--c-hover);
}
.item.selected {
	background: color-mix(in srgb, var(--c-accent) 14%, transparent);
	border-left-color: var(--c-accent);
}
.item.attention {
	border-left-color: var(--c-warn);
}
.thumb {
	width: 64px;
	height: 40px;
	flex-shrink: 0;
	border-radius: 4px;
	overflow: hidden;
	background: var(--c-hover);
}
.thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}
.thumb-ph {
	width: 100%;
	height: 100%;
}
.main {
	min-width: 0;
	flex: 1;
}
.title {
	font-size: 13px;
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.sub {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 4px;
}
.step {
	font-size: 11px;
	color: var(--c-muted);
}
.actions {
	margin-top: 4px;
}
</style>
