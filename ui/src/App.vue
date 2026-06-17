<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { darkTheme, zhCN, dateZhCN } from "naive-ui";
import { useTasksStore } from "./stores/tasks";
import { useEngineStore } from "./stores/engine";
import { connectEvents } from "./api/events";
import QueuePanel from "./components/QueuePanel.vue";
import ContextPane from "./components/ContextPane.vue";

const store = useTasksStore();
const engine = useEngineStore();
let disconnect: (() => void) | undefined;

const statusMeta = computed(() => {
  switch (engine.status) {
    case "connected":
      return { color: "#3fb950", text: "引擎已连接" };
    case "connecting":
      return { color: "#d29922", text: "连接中…" };
    default:
      return { color: "#f85149", text: "引擎已断开" };
  }
});

onMounted(async () => {
  // 初始 HTTP 拉取一次，之后由 SSE 增量更新。
  await store.fetchAll().catch(() => engine.setStatus("disconnected"));
  disconnect = connectEvents({
    onEvent: (e) => store.applyEvent(e),
    onOpen: () => engine.setStatus("connected"),
    onError: () => engine.setStatus("disconnected"),
  });
});
onUnmounted(() => disconnect?.());
</script>

<template>
  <n-config-provider :theme="darkTheme" :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider>
      <n-dialog-provider>
        <div class="app-shell">
          <header class="app-titlebar">
            <span class="app-title">diggo-press</span>
            <span class="app-subtitle">YouTube 视频 → 图文文章</span>
            <span class="app-engine">
              <span class="dot" :style="{ background: statusMeta.color }" />
              {{ statusMeta.text }}
            </span>
          </header>
          <div class="app-body">
            <QueuePanel class="app-queue" />
            <ContextPane class="app-context" />
          </div>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.app-titlebar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 18px;
  height: 48px;
  border-bottom: 1px solid var(--n-border-color, #2a2f3a);
  flex-shrink: 0;
}
.app-title {
  font-weight: 600;
  font-size: 15px;
}
.app-subtitle {
  color: #9aa3b2;
  font-size: 12px;
}
.app-engine {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #9aa3b2;
}
.app-engine .dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.app-queue {
  width: 340px;
  flex-shrink: 0;
  border-right: 1px solid var(--n-border-color, #2a2f3a);
  min-height: 0;
}
.app-context {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
</style>
