/**
 * 引擎连接状态（Pinia）：驱动标题栏状态灯。
 * 由 ws 连接生命周期（EventSource onopen/onerror）更新，组件只读不写网络。
 */
import { defineStore } from "pinia";
import { ref } from "vue";

export type EngineStatus = "connected" | "connecting" | "disconnected";

export const useEngineStore = defineStore("engine", () => {
  const status = ref<EngineStatus>("connecting");

  function setStatus(s: EngineStatus): void {
    status.value = s;
  }

  return { status, setStatus };
});
