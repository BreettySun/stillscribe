import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";

const ENGINE = process.env.DIGGO_ENGINE_URL ?? "http://127.0.0.1:8787";

// 开发期：所有引擎请求走 /api 前缀代理到本地引擎（免 CORS、避免与同源路径冲突）。
// 套壳/部署时改前端 BASE 直连 localhost，组件代码不动（先 Web 后套壳）。
export default defineConfig({
  plugins: [
    vue(),
    // Naive UI 组件/组合式 API 自动按需导入，模板内直接用 n-* 无需手动 import。
    AutoImport({
      imports: [
        "vue",
        {
          "naive-ui": ["useDialog", "useMessage", "useNotification", "useLoadingBar"],
        },
      ],
      dts: "src/auto-imports.d.ts",
    }),
    Components({
      resolvers: [NaiveUiResolver()],
      dts: "src/components.d.ts",
      // 仅自动注册 Naive UI，本地组件保持显式 import（便于 AI 精准定位）。
      dirs: [],
    }),
  ],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: ENGINE,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
