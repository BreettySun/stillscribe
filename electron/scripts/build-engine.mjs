/**
 * 把引擎打成单文件 CJS（out/engine/serve.cjs），供主进程在打包后用
 * `process.execPath + ELECTRON_RUN_AS_NODE` 启动（见 src/main/index.ts）。
 *
 * 只把原生模块（better-sqlite3 / sharp）标为 external——它们带 .node，无法 bundle，
 * 运行时从 electron/node_modules 解析（electron-builder 随包 + asarUnpack）。
 * 纯 JS 依赖（fastify / docx / @fastify/cors 等）一并打进 bundle。
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url)); // electron/scripts
const electronRoot = path.resolve(here, "..");
const repoRoot = path.resolve(electronRoot, "..");

await build({
  entryPoints: [path.join(repoRoot, "engine", "src", "serve.ts")],
  // CJS 输出（.cjs）：fastify/avvio 等依赖内部用 CommonJS require()，ESM bundle 下 esbuild 会把
  // 这些 require 变成抛错的 __require 桩（"Dynamic require not supported"）。CJS 输出里 require 原生可用。
  outfile: path.join(electronRoot, "out", "engine", "serve.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  // 原生模块不可打包：保持 external，运行时 require electron/node_modules 下的实现。
  external: ["better-sqlite3", "sharp"],
  // 引擎用 `@shared/types`（见 engine/tsconfig.json paths）。
  alias: { "@shared": path.join(repoRoot, "shared") },
  // CJS 下 import.meta.url 为空 → tools.ts 顶层 fileURLToPath(import.meta.url) 会抛错。
  // 用 __filename 还原其值（esbuild 标准配方：define 把 token 换成标识符，banner 定义该标识符）。
  define: { "import.meta.url": "import_meta_url" },
  banner: {
    js: "const import_meta_url = require('url').pathToFileURL(__filename).href;",
  },
  // 引擎以 .ts 扩展名相对导入（./paths.ts 等），esbuild 原生支持，无需额外 loader。
  logLevel: "info",
});

console.log("✅ 引擎已打包: electron/out/engine/serve.cjs");
