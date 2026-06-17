<script setup lang="ts">
/** 左栏：读 tasksStore.list 渲染队列；点击切换选中（master-detail）。 */
import { useTasksStore } from "../stores/tasks";
import QueueItem from "./QueueItem.vue";

const store = useTasksStore();
</script>

<template>
	<div class="queue">
		<div class="queue-head">
			<span class="queue-title">任务队列</span>
			<n-button
				size="tiny"
				tertiary
				:type="store.selectedId === null ? 'primary' : 'default'"
				@click="store.setSelected(null)">
				＋ 新建
			</n-button>
		</div>
		<n-scrollbar class="queue-list">
			<n-empty
				v-if="store.list.length === 0"
				description="还没有任务"
				class="queue-empty">
				<template #extra>提交一个 URL 开始</template>
			</n-empty>
			<QueueItem
				v-for="t in store.list"
				:key="t.id"
				:task="t"
				:selected="t.id === store.selectedId"
				@click="store.setSelected(t.id)" />
		</n-scrollbar>
	</div>
</template>

<style scoped>
.queue {
	display: flex;
	flex-direction: column;
	height: 100%;
}
.queue-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 12px;
	border-bottom: 1px solid var(--c-border);
	flex-shrink: 0;
}
.queue-title {
	font-weight: 600;
	font-size: 13px;
}
.queue-list {
	flex: 1;
	min-height: 0;
}
.queue-empty {
	margin-top: 40px;
}
</style>
