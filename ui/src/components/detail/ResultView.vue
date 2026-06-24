<script setup lang="ts">
/** 终态：completed（打开 docx / 重新生成）、failed（错误 + 重试）、canceled（重新提交）。 */
import { ref } from "vue";
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
  try {
    const url = await store.importToFeishu(props.task.id);
    message.success(url ? "已导入飞书" : "导入完成");
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    importing.value = false;
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
  <n-space vertical :size="16">
    <h2 class="title">{{ task.videoTitle ?? task.params.url }}</h2>

    <!-- 已完成 -->
    <template v-if="task.status === 'completed'">
      <n-alert type="success" title="任务已完成" />
      <n-card v-if="task.outputDocx" size="small" title="输出 docx">
        <p class="mono">{{ task.outputDocx }}</p>
        <n-space>
          <n-button v-if="isDesktop" @click="revealInFolder(task.outputDocx!)">
            在 Finder 中显示
          </n-button>
          <n-button tertiary :loading="exporting" @click="onRegenerate">重新生成</n-button>
        </n-space>
      </n-card>

      <n-card v-if="settings.feishuConfigured" size="small" title="飞书">
        <n-space vertical :size="8">
          <a
            v-if="task.feishuUrl"
            :href="task.feishuUrl"
            target="_blank"
            rel="noreferrer"
          >
            <n-button type="primary">在飞书中打开</n-button>
          </a>
          <n-button
            v-else
            :loading="importing"
            @click="onImportFeishu"
          >
            导入飞书
          </n-button>
        </n-space>
      </n-card>
    </template>

    <!-- 失败 -->
    <template v-else-if="task.status === 'failed'">
      <n-alert type="error" title="任务失败">{{ task.error }}</n-alert>
      <n-button type="primary" @click="onResubmit">重试（重新提交）</n-button>
    </template>

    <!-- 已取消 -->
    <template v-else>
      <n-alert type="warning" title="任务已取消" />
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
