<script setup lang="ts">
/** 终态：completed（导出文件列表 / 重新导出）、failed（错误 + 返回校对）、canceled（重新提交）。 */
import { computed, ref } from "vue";
import { useMessage } from "naive-ui";
import type { Task } from "@shared/types";
import { useTasksStore } from "../../stores/tasks";
import { isDesktop, revealInFolder } from "../../bridge";
import { listOutputs } from "../../exportFormats";

const props = defineProps<{ task: Task }>();
const store = useTasksStore();
const message = useMessage();

const exporting = ref(false);
const goingBack = ref(false);

/** 已导出的文件（按格式），全部在任务目录 article/ 下。 */
const outputs = computed(() => listOutputs(props.task.outputs));

/** 原样重新导出全部格式（覆盖同路径；文件被误删或想刷新时用）。 */
async function onReexport(): Promise<void> {
	exporting.value = true;
	try {
		const { warnings } = await store.exportArticle(props.task.id);
		if (warnings.length > 0) {
			message.warning(`已重新导出，但有 ${warnings.length} 处问题：${warnings[0]}`);
		} else {
			message.success("已重新导出");
		}
	} catch (e) {
		message.error(e instanceof Error ? e.message : String(e));
	} finally {
		exporting.value = false;
	}
}

/** 返回上一步：结果页 / 导出失败页 → 校对页（引擎回迁到 awaiting_review，article 保留）。 */
async function onBack(): Promise<void> {
	goingBack.value = true;
	try {
		await store.reopenReview(props.task.id);
	} catch (e) {
		message.error(e instanceof Error ? e.message : String(e));
	} finally {
		goingBack.value = false;
	}
}

async function onResubmit(): Promise<void> {
	try {
		const ids = await store.submit([props.task.params]);
		if (ids[0]) store.setSelected(ids[0]);
		message.success("已重新提交");
	} catch (e) {
		message.error(e instanceof Error ? e.message : String(e));
	}
}
</script>

<template>
	<n-space
		vertical
		:size="16">
		<h2 class="title">{{ task.videoTitle ?? task.params.url }}</h2>

		<!-- 已完成 -->
		<template v-if="task.status === 'completed'">
			<n-alert
				type="success"
				title="任务已完成" />
			<n-card
				v-if="outputs.length > 0"
				size="small"
				title="导出文件">
				<n-space
					vertical
					:size="12">
					<div
						v-for="row in outputs"
						:key="row.format"
						class="output">
						<div class="output-text">
							<div>
								<span class="output-label">{{ row.label }}</span>
								<span class="output-hint">{{ row.hint }}</span>
							</div>
							<p class="mono">{{ row.path }}</p>
						</div>
						<n-button
							v-if="isDesktop"
							size="small"
							@click="revealInFolder(row.path)">
							在 Finder 中显示
						</n-button>
					</div>
					<n-button
						tertiary
						:loading="exporting"
						@click="onReexport">
						重新导出
					</n-button>
				</n-space>
			</n-card>

			<n-button
				:loading="goingBack"
				@click="onBack">
				← 返回上一步
			</n-button>
		</template>

		<!-- 失败 -->
		<template v-else-if="task.status === 'failed'">
			<n-alert
				type="error"
				title="任务失败">
				{{ task.error }}
			</n-alert>
			<n-space>
				<!-- 导出阶段失败：article 还在，回校对重试即可，无需重跑整条流水线 -->
				<n-button
					v-if="task.article"
					:loading="goingBack"
					@click="onBack">
					← 返回上一步
				</n-button>
			</n-space>
		</template>

		<!-- 已取消 -->
		<template v-else>
			<n-alert
				type="warning"
				title="任务已取消" />
			<n-button @click="onResubmit">重新提交</n-button>
		</template>
	</n-space>
</template>

<style scoped>
.title {
	margin: 0;
	font-size: 18px;
}
.output {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}
.output-text {
	min-width: 0;
}
.output-label {
	font-weight: 600;
}
.output-hint {
	margin-left: 8px;
	font-size: 12px;
	opacity: 0.65;
}
.mono {
	margin: 2px 0 0;
	font-family: ui-monospace, "SF Mono", Menlo, monospace;
	word-break: break-all;
	font-size: 12px;
}
</style>
