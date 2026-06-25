/**
 * 飞书开放平台 API 薄封装（《飞书集成》§6）。出站仅飞书（铁律 #6）。
 *
 * 用 Node 自带全局 fetch / FormData / Blob（Electron 33 / Node 20 已内置），不引第三方 HTTP 库。
 * 流程：换 tenant token → 上传 docx 素材到云空间 → 提交 docx 导入任务 → 轮询直至生成在线文档。
 * token 在模块内单例缓存，提前 60s 失效重取；遇凭证失效错误码自动清缓存重试一次。
 */
import type { ResolvedFeishuConfig } from "./config.ts";

/** 飞书凭证失效相关错误码：命中则清 token 缓存重试一次。 */
const TOKEN_INVALID_CODES = new Set([99991663, 99991661, 99991664, 99991668]);

interface TokenCache {
  token: string;
  /** epoch ms，已减去 60s 安全余量。 */
  expiresAt: number;
}
let tokenCache: TokenCache | undefined;

/** 仅供测试重置缓存。 */
export function _resetTokenCache(): void {
  tokenCache = undefined;
}

class FeishuError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "FeishuError";
  }
}

/** 统一解析飞书响应：非 2xx 或 code!==0 抛 FeishuError（带 code 与 msg）。 */
async function parseFeishu<T>(res: Response, what: string): Promise<T> {
  let json: { code?: number; msg?: string; data?: unknown } & Record<string, unknown>;
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new FeishuError(`飞书${what}失败：HTTP ${res.status}，响应非 JSON`);
  }
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new FeishuError(
      `飞书${what}失败：code=${json.code} msg=${json.msg ?? res.statusText}`,
      json.code,
    );
  }
  return json as T;
}

/** 换取 tenant_access_token（应用身份），命中缓存直接返回。 */
async function getTenantToken(cfg: ResolvedFeishuConfig): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) return tokenCache.token;

  const res = await fetch(`${cfg.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
  });
  const json = await parseFeishu<{ tenant_access_token: string; expire: number }>(res, "换取 token");
  tokenCache = {
    token: json.tenant_access_token,
    expiresAt: now + Math.max(0, (json.expire - 60)) * 1000,
  };
  return tokenCache.token;
}

/** 带 token 的请求；命中凭证失效码自动清缓存重试一次。 */
async function authedFetch(
  cfg: ResolvedFeishuConfig,
  build: (token: string) => { url: string; init: RequestInit },
): Promise<Response> {
  const token = await getTenantToken(cfg);
  const { url, init } = build(token);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  let res = await fetch(url, { ...init, headers });

  // 仅在凭证失效时清缓存重试一次（读 clone 避免吞掉正常响应体）。
  if (!res.ok || res.headers.get("content-type")?.includes("application/json")) {
    const peek = await res.clone().json().catch(() => undefined);
    const code = (peek as { code?: number } | undefined)?.code;
    if (code !== undefined && TOKEN_INVALID_CODES.has(code)) {
      _resetTokenCache();
      const fresh = await getTenantToken(cfg);
      const retryHeaders = new Headers(init.headers);
      retryHeaders.set("authorization", `Bearer ${fresh}`);
      res = await fetch(url, { ...init, headers: retryHeaders });
    }
  }
  return res;
}

/** 上传 docx 到云空间目标文件夹，返回 file_token。 */
export async function uploadDocx(
  cfg: ResolvedFeishuConfig,
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const form = new FormData();
  form.append("file_name", fileName);
  form.append("parent_type", "explorer");
  form.append("parent_node", cfg.folderToken!);
  form.append("size", String(buffer.length));
  form.append("file", new Blob([buffer]), fileName);

  const res = await authedFetch(
    cfg,
    () => ({
      url: `${cfg.baseUrl}/open-apis/drive/v1/files/upload_all`,
      init: { method: "POST", body: form },
    }),
  );
  const json = await parseFeishu<{ data: { file_token: string } }>(res, "上传素材");
  return json.data.file_token;
}

/**
 * 删除云空间文件。导入完成后清理上传的中间 docx 素材，只保留生成的在线文档。
 * type 对应飞书文件类型，上传的 docx 即普通文件 "file"。
 */
export async function deleteFile(
  cfg: ResolvedFeishuConfig,
  fileToken: string,
  type = "file",
): Promise<void> {
  const res = await authedFetch(
    cfg,
    () => ({
      url: `${cfg.baseUrl}/open-apis/drive/v1/files/${encodeURIComponent(fileToken)}?type=${encodeURIComponent(type)}`,
      init: { method: "DELETE" },
    }),
  );
  await parseFeishu<{ data?: unknown }>(res, "删除素材");
}

/** 提交 docx → 在线文档 导入任务，返回 ticket。 */
export async function createImportTask(
  cfg: ResolvedFeishuConfig,
  fileToken: string,
  fileName: string,
): Promise<string> {
  // 文档标题去掉 .docx 扩展名。
  const title = fileName.replace(/\.docx$/i, "");
  const body = {
    file_extension: "docx",
    file_token: fileToken,
    type: "docx",
    file_name: title,
    point: { mount_type: 1, mount_key: cfg.folderToken },
  };
  const res = await authedFetch(
    cfg,
    () => ({
      url: `${cfg.baseUrl}/open-apis/drive/v1/import_tasks`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      },
    }),
  );
  const json = await parseFeishu<{ data: { ticket: string } }>(res, "提交导入任务");
  return json.data.ticket;
}

export interface ImportResult {
  /** 新建在线文档 token。 */
  token: string;
  /** 可直接打开的文档链接。 */
  url: string;
}

interface ImportTaskResultData {
  result: {
    /** 0=成功，1=初始化，2=处理中，其余=失败。 */
    job_status: number;
    job_error_msg?: string;
    token?: string;
    url?: string;
    type?: string;
  };
}

/**
 * 轮询导入任务直至完成。
 * maxAttempts/intervalMs 控制超时与节流；超时抛错。sleep 注入便于测试。
 */
export async function pollImportTask(
  cfg: ResolvedFeishuConfig,
  ticket: string,
  opts: {
    maxAttempts?: number;
    intervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
    onProgress?: (msg: string) => void;
  } = {},
): Promise<ImportResult> {
  const maxAttempts = opts.maxAttempts ?? 30;
  const intervalMs = opts.intervalMs ?? 2000;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await authedFetch(
      cfg,
      () => ({
        url: `${cfg.baseUrl}/open-apis/drive/v1/import_tasks/${encodeURIComponent(ticket)}`,
        init: { method: "GET" },
      }),
    );
    const json = await parseFeishu<{ data: ImportTaskResultData }>(res, "查询导入任务");
    const r = json.data.result;
    if (r.job_status === 0) {
      if (!r.token || !r.url) throw new FeishuError("飞书导入成功但未返回文档 token/链接");
      return { token: r.token, url: r.url };
    }
    if (r.job_status === 1 || r.job_status === 2) {
      opts.onProgress?.(`等待飞书生成文档…（${attempt}/${maxAttempts}）`);
      await sleep(intervalMs);
      continue;
    }
    throw new FeishuError(`飞书导入任务失败：${r.job_error_msg ?? `job_status=${r.job_status}`}`);
  }
  throw new FeishuError(`飞书导入轮询超时（${maxAttempts} 次仍未完成）`);
}
