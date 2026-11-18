<script setup lang="ts">
/**
 * awaiting_review：两种形态——
 *  · 已有 article（已回填/换图后）：逐页校对 + 换图(FramePicker) 为主，回填工具收进折叠区。
 *  · 尚无 article（semi 模式的常态，引擎停在 grids 等人工回填）：宫格图 + JSON 回填为主，置顶展示。
 * 正文只渲染 body/subhead；notes/中文 CoT 仅折叠展示，绝不进正文/导出文件（CLAUDE.md 铁律 #4）。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useMessage } from "naive-ui";
import type { Article, Task, Timestamp } from "@shared/types";
import { useTasksStore } from "../../stores/tasks";
import { api } from "../../api/client";
import ArticlePageCard from "./ArticlePageCard.vue";
import FramePicker from "./FramePicker.vue";
import ArticleEditor from "./ArticleEditor.vue";

const props = defineProps<{ task: Task }>();
const store = useTasksStore();
const message = useMessage();

const editingPage = ref<number | null>(null);
const grids = ref<string[]>([]);
const exporting = ref(false);
const saving = ref(false);
const saveError = ref<string | null>(null);

const article = computed<Article | undefined>(
	() => props.task.article ?? undefined,
);
const hasArticle = computed(
	() => !!article.value && article.value.pages.length > 0,
);

onMounted(loadGrids);
watch(
	() => props.task.id,
	() => {
		editingPage.value = null;
		loadGrids();
	},
);

async function loadGrids(): Promise<void> {
	try {
		grids.value = (await api.listGrids(props.task.id)).files;
	} catch {
		grids.value = [];
	}
}

async function onPick(pageIndex: number, image: Timestamp): Promise<void> {
	try {
		await store.swap(props.task.id, { pageIndex, image });
		editingPage.value = null;
		message.success(`第 ${pageIndex + 1} 页配图已更新`);
	} catch (e) {
		message.error(e instanceof Error ? e.message : String(e));
	}
}

async function onSaveArticle(next: Article): Promise<void> {
	saving.value = true;
	saveError.value = null;
	try {
		await store.saveArticle(props.task.id, next);
		message.success("文章已保存");
	} catch (e) {
		saveError.value = e instanceof Error ? e.message : String(e);
	} finally {
		saving.value = false;
	}
}

async function onExport(): Promise<void> {
	exporting.value = true;
	try {
		const { warnings } = await store.exportArticle(props.task.id);
		if (warnings.length > 0) message.warning(`导出完成，但有 ${warnings.length} 处问题：${warnings[0]}`);
		else message.success("导出完成");
	} catch (e) {
		message.error(e instanceof Error ? e.message : String(e));
	} finally {
		exporting.value = false;
	}
}
</script>

<template>
	<n-space
		vertical
		:size="16">
		<div class="head">
			<div>
				<h2 class="title">{{ task.videoTitle ?? task.params.url }}</h2>
				<p
					class="hint"
					v-if="hasArticle">
					共 {{ article!.pages.length }} 页 · 点击配图可换图
				</p>
				<p
					class="hint"
					v-else>
					等待回填文章：宫格图 + 字幕交给模型，按 Article 契约生成 JSON
				</p>
			</div>
			<n-button
				type="primary"
				:loading="exporting"
				:disabled="!hasArticle"
				@click="onExport">
				✓ 确认并导出
			</n-button>
		</div>

		<n-alert
			v-if="!hasArticle && task.autoError"
			type="warning"
			title="自动生成失败，已转为人工回填"
			:closable="false">
			<div>{{ task.autoError }}</div>
			<div>可以在下方手动回填，或到设置里检查模型配置。</div>
		</n-alert>

		<!-- 已有 article：逐页校对 + 换图 -->
		<template v-if="hasArticle">
			<ArticlePageCard
				v-for="(page, i) in article!.pages"
				:key="i"
				:task="task"
				:page="page"
				:index="i"
				:editing="editingPage === i"
				@edit="editingPage = editingPage === i ? null : i">
				<template #picker>
					<FramePicker
						v-if="editingPage === i"
						:task-id="task.id"
						:current="page.image"
						@pick="(image) => onPick(i, image)"
						@close="editingPage = null" />
				</template>
			</ArticlePageCard>

			<n-card
				size="small"
				title="Meta">
				<p><strong>标题候选：</strong>{{ article!.meta.titles.join(" | ") }}</p>
				<p><strong>关键词：</strong>{{ article!.meta.keywords.join(", ") }}</p>
				<p><strong>描述：</strong>{{ article!.meta.description }}</p>
			</n-card>

			<n-collapse>
				<n-collapse-item
					v-if="article!.notes"
					title="说明 / CoT（仅参考 · 不进导出文件）"
					name="notes">
					<p
						v-if="article!.notes.frameworkRationale"
						class="notes">
						{{ article!.notes.frameworkRationale }}
					</p>
					<p
						v-if="article!.notes.imageRationale"
						class="notes">
						{{ article!.notes.imageRationale }}
					</p>
				</n-collapse-item>
				<n-collapse-item
					v-if="task.params.mode === 'semi'"
					title="重新回填 JSON"
					name="json">
					<ArticleEditor
						:busy="saving"
						:server-error="saveError"
						@save="onSaveArticle" />
				</n-collapse-item>
			</n-collapse>
		</template>

		<!-- 尚无 article：半自动回填为主 -->
		<template v-else>
			<n-card
				v-if="grids.length"
				size="small"
				:title="`宫格图（${grids.length}）`">
				<div class="grids">
					<a
						v-for="f in grids"
						:key="f"
						:href="api.gridUrl(task.id, f)"
						target="_blank">
						<img
							:src="api.gridUrl(task.id, f)"
							:alt="f"
							loading="lazy" />
					</a>
				</div>
			</n-card>

			<n-card
				size="small"
				title="回填文章 JSON">
				<ArticleEditor
					:busy="saving"
					:server-error="saveError"
					@save="onSaveArticle" />
			</n-card>
		</template>
	</n-space>
</template>

<style scoped>
.head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 16px;
}
.title {
	margin: 0 0 4px;
	font-size: 18px;
}
.hint {
	margin: 0;
	font-size: 12px;
	color: var(--c-muted);
}
.notes {
	color: var(--c-muted);
	font-size: 13px;
}
.grids {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	gap: 10px;
}
.grids img {
	width: 100%;
	border-radius: 4px;
	display: block;
}
</style>
