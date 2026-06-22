/**
 * 本地 .env 加载（引擎私有配置，不进 git —— 根 .gitignore 已忽略 .env）。
 *
 * 用途：把 Gemini API Key / 模型等「由代码侧配置、对最终用户透明」的值，从 engine/.env 读入 process.env。
 * 【铁律 #6】Key 只在本地，绝不硬编码进提交源码、绝不入库。值放 engine/.env（已忽略），
 *           模板见 engine/.env.example。
 *
 * 用 Node 原生 process.loadEnvFile（Node 20.12+；Electron 33 自带的 Node 亦满足），零依赖。
 * 文件缺失/不可读时静默跳过——env 不存在不是错误（CI、未配置 Key 的开发机都正常）。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** engine/ 根（本文件在 engine/src/ 下）。 */
const engineRoot = path.join(here, "..");

/** 加载 engine/.env 到 process.env（已存在的环境变量优先，不被覆盖）。幂等、可安全多调。 */
export function loadDotEnv(): void {
  const file = path.join(engineRoot, ".env");
  try {
    process.loadEnvFile(file);
  } catch {
    /* 文件不存在或不可读 → 跳过 */
  }
}
