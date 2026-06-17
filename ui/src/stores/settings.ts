/**
 * UI 偏好设置（Pinia）：主题（auto/light/dark）+ cookie 来源浏览器。
 * 持久化到引擎 SQLite（GET/POST /settings），跨刷新/重启保留——不用 localStorage（CLAUDE.md 铁律 #9）。
 * 初始用默认值，load() 从引擎拉取后覆盖；set* 即时写回引擎。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { UI_DEFAULTS, type CookieBrowser, type ThemeMode } from "@shared/types";
import { api } from "../api/client";

export type { ThemeMode };

export const useSettingsStore = defineStore("settings", () => {
  const mode = ref<ThemeMode>(UI_DEFAULTS.theme);
  const cookieBrowser = ref<CookieBrowser>(UI_DEFAULTS.cookieBrowser);

  // 系统偏好（matchMedia 在渲染进程恒存在；监听变化以便 auto 实时跟随）。
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const prefersDark = ref(mql.matches);
  mql.addEventListener("change", (e) => (prefersDark.value = e.matches));

  const isDark = computed(() =>
    mode.value === "dark" || (mode.value === "auto" && prefersDark.value),
  );

  /** 从引擎拉取持久化偏好（启动时调用一次）。 */
  async function load(): Promise<void> {
    try {
      const s = await api.getSettings();
      mode.value = s.theme;
      cookieBrowser.value = s.cookieBrowser;
    } catch {
      /* 引擎未就绪：保持默认 */
    }
  }

  /** 切换主题并即时写回引擎（fire-and-forget，失败不阻塞 UI）。 */
  function setMode(m: ThemeMode): void {
    mode.value = m;
    void api.saveSettings({ theme: m }).catch(() => {});
  }

  /** 设置 cookie 来源浏览器并即时写回引擎。 */
  function setCookieBrowser(b: CookieBrowser): void {
    cookieBrowser.value = b;
    void api.saveSettings({ cookieBrowser: b }).catch(() => {});
  }

  return { mode, isDark, cookieBrowser, load, setMode, setCookieBrowser };
});
