import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";

// 主进程/preload 由 electron-vite(esbuild) 打包；渲染进程复用现有 ui/ 工程（不重写）。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // @engine 让主进程复用引擎的纯函数（如 cookie 过滤），esbuild 打包，无原生依赖。
    resolve: { alias: { "@engine": resolve(__dirname, "../engine/src") } },
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
    // 与 ui/vite.config.ts 保持一致：Naive UI 按需自动注册/导入。
    // electron-vite 用本配置构建渲染进程（不读 ui/vite.config.ts），故须在此重复声明。
    plugins: [
      vue(),
      AutoImport({
        imports: [
          "vue",
          { "naive-ui": ["useDialog", "useMessage", "useNotification", "useLoadingBar"] },
        ],
        dts: resolve(__dirname, "../ui/src/auto-imports.d.ts"),
      }),
      Components({
        resolvers: [NaiveUiResolver()],
        dts: resolve(__dirname, "../ui/src/components.d.ts"),
        dirs: [],
      }),
    ],
    build: {
      rollupOptions: { input: resolve(__dirname, "../ui/index.html") },
    },
  },
});
