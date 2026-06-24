<script setup lang="ts">
/** 终态：completed（打开 docx / 重新生成）、failed（错误 + 重试）、canceled（重新提交）。 */
import { computed, ref, watch } from "vue";
import { useMessage } from "naive-ui";
import type { Task } from "@shared/types";
import { useTasksStore } from "../../stores/tasks";
import { useSettingsStore } from "../../stores/settings";
import { isDesktop, revealInFolder } from "../../bridge";

const props = defineProps<{ task: Task }>();
const store = useTasksStore();
const settings = useSettingsStore();
const message = useMessage();

const exporting = ref(false);
const importing = ref(false);
const goingBack = ref(false);
/** 飞书结果页「返回上一步」→ docx 结果页：纯 UI 折叠飞书链接（不动 task.feishuUrl）。 */
const hideFeishu = ref(false);
const showFeishuLink = computed(
	() => !!props.task.feishuUrl && !hideFeishu.value,
);
// 切换任务时复位（否则换任务后残留上一个的折叠态）。
watch(
	() => props.task.id,
	() => {
		hideFeishu.value = false;
	},
);

async function onRegenerate(): Promise<void> {
	exporting.value = true;
	try {
		await store.exportDocx(props.task.id);
		message.success("已重新生成 docx");
	} catch (e) {
		message.error(e instanceof Error ? e.message : String(e));
	} finally {
		exporting.value = false;
	}
}

async function onImportFeishu(): Promise<void> {
	importing.value = true;
	hideFeishu.value = false; // 重新导入后正常展示新链接
	try {
		const url = await store.importToFeishu(props.task.id);
		message.success(url ? "已导入飞书" : "导入完成");
	} catch (e) {
		message.error(e instanceof Error ? e.message : String(e));
	} finally {
		importing.value = false;
	}
}

/**
 * 返回上一步（按当前所处步派发）：
 * - 飞书结果页(completed+link) → docx 结果页：仅折叠链接。
 * - 飞书失败页(failed + 有 docx 留底) → docx 结果页：failed → completed。
 * - docx 结果页 / docx 阶段失败 → 校对页：→ awaiting_review。
 */
async function onBack(): Promise<void> {
	if (showFeishuLink.value) {
		hideFeishu.value = true; // 飞书 → docx（仅折叠链接）
		return;
	}
	goingBack.value = true;
	try {
		if (props.task.status === "failed" && props.task.outputDocx) {
			await store.reopenDocxResult(props.task.id); // 飞书失败 → docx 结果页
		} else {
			await store.reopenReview(props.task.id); // docx → 校对（引擎回迁状态）
		}
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
				v-if="task.outputDocx"
				size="small"
				title="输出 docx">
				<p class="mono">{{ task.outputDocx }}</p>
				<n-space>
					<n-button
						v-if="isDesktop"
						@click="revealInFolder(task.outputDocx!)">
						在 Finder 中显示
					</n-button>
					<n-button
						tertiary
						:loading="exporting"
						@click="onRegenerate">
						重新生成
					</n-button>
				</n-space>
			</n-card>

			<n-card
				v-if="settings.feishuConfigured"
				size="small"
				title="飞书">
				<n-space
					vertical
					:size="8">
					<a
						v-if="showFeishuLink"
						:href="task.feishuUrl!"
						target="_blank"
						rel="noreferrer">
						<n-button type="primary">在飞书中打开</n-button>
					</a>
					<n-button
						v-else
						:loading="importing"
						@click="onImportFeishu">
						导入飞书
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
				<!-- 导出/飞书阶段失败：article 还在，回校对重试即可，无需重跑整条流水线 -->
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
.mono {
	font-family: ui-monospace, "SF Mono", Menlo, monospace;
	word-break: break-all;
	font-size: 12px;
}
</style>
