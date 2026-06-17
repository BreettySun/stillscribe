<script setup lang="ts">
/** 右栏路由器：无选中 → SubmitForm；有选中 → TaskDetail。 */
import { useTasksStore } from "../stores/tasks";
import SubmitForm from "./submit/SubmitForm.vue";
import TaskDetail from "./detail/TaskDetail.vue";

const store = useTasksStore();
</script>

<template>
	<div class="context">
		<TaskDetail
			v-if="store.selected"
			:task="store.selected" />
		<SubmitForm v-else />
	</div>
</template>

<style scoped>
.context {
	padding: 20px 24px;
}
</style>
