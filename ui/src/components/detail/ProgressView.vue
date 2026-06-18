<script setup lang="ts">
/** running / queued：流水线步骤 + 进度条 + 取消。 */
import { computed } from "vue";
import type { PipelineStep, Task } from "@shared/types";
import { useTasksStore } from "../../stores/tasks";

const props = defineProps<{ task: Task }>();
const store = useTasksStore();

const STEPS: { key: PipelineStep; label: string }[] = [
	{ key: "download", label: "下载" },
	{ key: "frames", label: "抽帧" },
	{ key: "dedup", label: "去重" },
	{ key: "grids", label: "宫格图" },
	{ key: "article", label: "文章" },
	{ key: "docx", label: "生成 docx" },
];
const ORDER = STEPS.map((s) => s.key);

const progress = computed(() => store.progress[props.task.id]);
const currentIndex = computed(() => {
	const cur = props.task.currentStep;
	return cur ? ORDER.indexOf(cur) : 0;
});
const ratio = computed(() => progress.value?.ratio);
</script>

<template>
	<n-space
		vertical
		:size="20">
		<div>
			<h2 class="title">{{ task.videoTitle ?? "标题待解析" }}</h2>
			<p class="url">{{ task.params.url }}</p>
		</div>

		<n-steps
			:current="currentIndex + 1"
			size="small">
			<n-step
				v-for="s in STEPS"
				:key="s.key"
				:title="s.label" />
		</n-steps>

		<div>
			<n-progress
				processing
				type="line"
				status="success"
				:percentage="ratio != null ? Math.round(ratio * 100) : 0"
				:indicator-placement="'inside'" />
			<p
				v-if="progress?.message"
				class="msg">
				{{ progress.message }}
			</p>
		</div>

		<n-button
			type="error"
			ghost
			@click="store.cancel(task.id)">
			取消任务
		</n-button>
	</n-space>
</template>

<style scoped>
.title {
	margin: 0 0 4px;
	font-size: 18px;
}
.url {
	margin: 0;
	font-size: 12px;
	color: var(--c-muted);
	word-break: break-all;
}
.msg {
	margin: 8px 0 0;
	font-size: 12px;
	color: var(--c-muted);
}
</style>
