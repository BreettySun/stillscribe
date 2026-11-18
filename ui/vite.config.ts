import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";

const ENGINE = process.env.DIGGO_ENGINE_URL ?? "http://127.0.0.1:8787";

/**
 * 引擎接口令牌（engine/src/auth.ts）。纯 Web 开发模式下浏览器页面不持有令牌，由本代理代为附加。
 * 来源：env DIGGO_TOKEN > 引擎自动生成的令牌文件 <工作根>/engine-token（文件名与 engine/src/paths.ts 一致）。
 * 每个请求现读：引擎重启会换新令牌，无需跟着重启 Vite。
 */
// 工作根的解析与引擎一致（engine/src/paths.ts 的 resolveWorkRoot）：相对路径按 engine/ 目录解析，默认 engine/work。
const ENGINE_DIR = fileURLToPath(new URL("../engine", import.meta.url));
const TOKEN_FILE = path.join(
  path.resolve(ENGINE_DIR, process.env.DIGGO_WORK_ROOT ?? "work"),
  "engine-token",
);
function engineToken(): string | undefined {
  if (process.env.DIGGO_TOKEN) return process.env.DIGGO_TOKEN;
  try {
    return readFileSync(TOKEN_FILE, "utf-8").trim() || undefined;
  } catch {
    return undefined; // 引擎还没起来：请求会得到 401，引擎就绪后自动恢复
  }
}

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
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const token = engineToken();
            if (token) proxyReq.setHeader("Authorization", `Bearer ${token}`);
            // 本页面自己发的同源请求：去掉 Origin，引擎按"非跨源"处理。
            // 其他网站借本代理发来的请求会保留它们自己的 Origin，被引擎的来源检查拒绝（403）。
            const { origin, host } = req.headers;
            if (origin && host && (origin === `http://${host}` || origin === `https://${host}`)) {
              proxyReq.removeHeader("Origin");
            }
          });
        },
      },
    },
  },
});
