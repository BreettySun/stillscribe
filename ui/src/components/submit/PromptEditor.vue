<script setup lang="ts">
/** 提示词编辑器：默认折叠。展开后可改本次提交所用的 Gemini 提示词。
 * 修改仅对本批提交生效，不回写引擎默认模板（CLAUDE.md §8）。
 * {{videoTitle}}/{{imageCount}} 为占位，生成时由引擎自动填充。 */
import { computed } from "vue";

const model = defineModel<string>({ required: true });

const props = defineProps<{
	/** 引擎默认模板，用于「恢复默认」与判断是否已修改。 */
	defaultTemplate: string;
}>();

const dirty = computed(
	() => props.defaultTemplate !== "" && model.value !== props.defaultTemplate,
);

function reset(): void {
	model.value = props.defaultTemplate;
}

const hint = `{{ videoTitle }} / {{ imageCount }} 将在生成时自动填充，不必手动处理`;
</script>

<template>
	<n-collapse>
		<n-collapse-item name="prompt">
			<template #header>
				<span class="prompt-header">提示词</span>
			</template>
			<template #header-extra>
				<n-tag
					v-if="dirty"
					size="small"
					type="warning"
					:bordered="false">
					已修改
				</n-tag>
			</template>
			<n-space
				vertical
				:size="8">
				<n-input
					v-model:value="model"
					type="textarea"
					:rows="12"
					:autosize="{ minRows: 12, maxRows: 28 }"
					placeholder="加载默认提示词…"
					class="prompt-textarea" />
				<n-flex
					justify="space-between"
					align="center">
					<span
						class="prompt-hint"
						v-text="hint">
					</span>
					<n-button
						text
						size="small"
						:disabled="!dirty"
						@click="reset">
						恢复默认
					</n-button>
				</n-flex>
			</n-space>
		</n-collapse-item>
	</n-collapse>
</template>

<style scoped>
.prompt-header {
	font-size: 13px;
}
.prompt-hint {
	font-size: 12px;
	color: var(--c-muted);
}
.prompt-textarea :deep(textarea) {
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
	font-size: 12px;
	line-height: 1.5;
}
</style>
