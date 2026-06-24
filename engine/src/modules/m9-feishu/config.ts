/**
 * M9 飞书导入配置：自建应用凭证 + 目标团队文件夹（《飞书集成》§4/§5）。
 *
 * 【设计】凭证全部由代码侧 env 配置，不暴露给渲染进程：
 *   - app_id / app_secret：仅来自 env DIGGO_FEISHU_APP_ID / DIGGO_FEISHU_APP_SECRET（engine/.env，见 env.ts）。
 *   - 目标团队文件夹：env DIGGO_FEISHU_FOLDER_TOKEN（import_tasks 的 point.mount_key）。
 *   - 站点：env DIGGO_FEISHU_BASE_URL 覆盖（默认国内站 open.feishu.cn；海外 Lark 用 open.larksuite.com）。
 * 【铁律 #6】凭证只在本地、绝不硬编码进提交源码、绝不入库；这里只读 env，不接受渲染进程明文。
 */
import type { FeishuSettings } from "@shared/types";

const DEFAULT_BASE_URL = "https://open.feishu.cn";

export interface ResolvedFeishuConfig {
  appId: string | undefined;
  appSecret: string | undefined;
  /** 目标团队文件夹 token（import_tasks 挂载点）。 */
  folderToken: string | undefined;
  /** 飞书开放平台基址（无尾斜杠）。 */
  baseUrl: string;
}

/** 解析飞书配置（纯读 env + 代码默认；调用前应已 loadDotEnv）。 */
export function resolveFeishuConfig(): ResolvedFeishuConfig {
  const baseUrl = (process.env.DIGGO_FEISHU_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return {
    appId: process.env.DIGGO_FEISHU_APP_ID || undefined,
    appSecret: process.env.DIGGO_FEISHU_APP_SECRET || undefined,
    folderToken: process.env.DIGGO_FEISHU_FOLDER_TOKEN || undefined,
    baseUrl,
  };
}

/** 凭证是否齐全（app_id + app_secret + folderToken 都配了才算可导入）。 */
export function isFeishuConfigured(cfg = resolveFeishuConfig()): boolean {
  return Boolean(cfg.appId && cfg.appSecret && cfg.folderToken);
}

/** 对渲染进程暴露的只读视图：只说"是否已配置"，绝不回读明文凭证。 */
export function readFeishuSettings(): FeishuSettings {
  return { configured: isFeishuConfigured() };
}
