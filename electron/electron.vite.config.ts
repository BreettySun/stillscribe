import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";

// 主进程/preload 由 electron-vite(esbuild) 打包；渲染进程复用现有 ui/ 工程（不重写）。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, "src/main/index.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, "src/preload/index.ts") } },
  },
  renderer: {
    root: resolve(__dirname, "../ui"),
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "../shared"),
        "@": resolve(__dirname, "../ui/src"),
      },
    },
    plugins: [vue()],
    build: {
      rollupOptions: { input: resolve(__dirname, "../ui/index.html") },
    },
  },
});
