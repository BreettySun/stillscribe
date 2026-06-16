import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const ENGINE = process.env.DIGGO_ENGINE_URL ?? "http://127.0.0.1:8787";

// 开发期：所有引擎请求走 /api 前缀代理到本地引擎（免 CORS、避免与 SPA 路由 /tasks/:id 冲突）。
// 套壳/部署时改前端 BASE 直连 localhost，组件代码不动（先 Web 后套壳）。
export default defineConfig({
  plugins: [vue()],
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
