/**
 * 主题模式（Pinia）：auto（跟随系统）/ light / dark。
 * 持久化到引擎 SQLite（GET/POST /settings），跨刷新/重启保留——不用 localStorage（CLAUDE.md 铁律 #9）。
 * 初始默认 auto（跟随系统），load() 从引擎拉取真实偏好后覆盖；setMode 即时写回引擎。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { ThemeMode } from "@shared/types";
import { api } from "../api/client";

export type { ThemeMode };

export const useThemeStore = defineStore("theme", () => {
  const mode = ref<ThemeMode>("auto");

  // 系统偏好（matchMedia 在渲染进程恒存在；监听变化以便 auto 实时跟随）。
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const prefersDark = ref(mql.matches);
  mql.addEventListener("change", (e) => (prefersDark.value = e.matches));

  const isDark = computed(() =>
    mode.value === "dark" || (mode.value === "auto" && prefersDark.value),
  );

  /** 从引擎拉取持久化的主题偏好（启动时调用一次）。 */
  async function load(): Promise<void> {
    try {
      mode.value = (await api.getSettings()).theme;
    } catch {
      /* 引擎未就绪：保持默认 auto */
    }
  }

  /** 切换并即时写回引擎（fire-and-forget，失败不阻塞 UI）。 */
  function setMode(m: ThemeMode): void {
    mode.value = m;
    void api.saveSettings({ theme: m }).catch(() => {});
  }

  return { mode, isDark, load, setMode };
});
