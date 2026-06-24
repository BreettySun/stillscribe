/**
 * M9 飞书导入（方案 2：docx 导入为在线文档，《飞书集成》§1/§6）。
 *
 * 串起：上传 docx 素材 → 提交导入任务 → 轮询直至生成 → 返回在线文档链接。
 * 凭证由 resolveFeishuConfig 从 engine/.env 读（铁律 #6）；调用前应确保 isFeishuConfigured()。
 */
import { resolveFeishuConfig, isFeishuConfigured } from "./config.ts";
import {
  uploadDocx,
  createImportTask,
  pollImportTask,
  type ImportResult,
} from "./client.ts";

export { readFeishuSettings, isFeishuConfigured, resolveFeishuConfig } from "./config.ts";

export interface ImportOptions {
  /** 导入后文档名（含 .docx 扩展，内部会去扩展名作标题）。 */
  fileName: string;
  /** 阶段进度回调（上传中 / 提交中 / 等待生成）。 */
  onProgress?: (msg: string) => void;
  /** 轮询参数（测试可注入）。 */
  poll?: Parameters<typeof pollImportTask>[2];
}

/** 把 docx buffer 导入飞书，返回 { url, token }。任一步失败抛错（调用方落 failed，本地 docx 已留底兜底）。 */
export async function importDocxToFeishu(
  buffer: Buffer,
  opts: ImportOptions,
): Promise<ImportResult> {
  const cfg = resolveFeishuConfig();
  if (!isFeishuConfigured(cfg)) {
    throw new Error("飞书凭证未配置（app_id / app_secret / folderToken），无法导入");
  }
  const { onProgress } = opts;

  onProgress?.("上传 docx 到飞书…");
  const fileToken = await uploadDocx(cfg, buffer, opts.fileName);

  onProgress?.("提交飞书导入任务…");
  const ticket = await createImportTask(cfg, fileToken, opts.fileName);

  onProgress?.("等待飞书生成在线文档…");
  return pollImportTask(cfg, ticket, { onProgress, ...opts.poll });
}
