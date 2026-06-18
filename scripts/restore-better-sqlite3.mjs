/**
 * 把 better-sqlite3 重编回**系统 Node** ABI，恢复引擎 dev/test。
 *
 * 背景：打包流程里的 `electron-rebuild` 会把 better-sqlite3 编成 Electron 的 Node ABI；
 * 因 pnpm 软链，engine 与 electron 共用 store 里同一份，于是打完包后 `pnpm test`/`pnpm dev`
 * 会报 NODE_MODULE_VERSION 不匹配。从源码重编即可恢复（系统 Node 较新，prebuilt 常缺）。
 * 已装好的 .app/.dmg 内部有独立的 Electron-ABI 副本，本步不影响产物。
 */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(new URL("../engine/package.json", import.meta.url));
// 从 engine 解析 better-sqlite3 真实安装目录（pnpm 软链也能解开）。
const dir = dirname(require.resolve("better-sqlite3/package.json"));

console.log(`→ 重编 better-sqlite3（系统 Node ABI）于:\n  ${dir}`);
execSync("npm run build-release", { cwd: dir, stdio: "inherit" });
console.log("✅ better-sqlite3 已恢复为系统 Node ABI（引擎 dev/test 可用）。");
