import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isFeishuConfigured, resolveFeishuConfig } from "./config.ts";
import {
  uploadDocx,
  createImportTask,
  pollImportTask,
  _resetTokenCache,
} from "./client.ts";

const cfg = {
  appId: "app",
  appSecret: "secret",
  folderToken: "fld_token",
  baseUrl: "https://open.feishu.cn",
};

/** 按 URL 后缀路由的 fetch 桩；token 端点恒返回有效 token。 */
function stubFetch(routes: Record<string, () => unknown>) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
      return new Response(
        JSON.stringify({ code: 0, tenant_access_token: "t-abc", expire: 7200 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch: ${url}`);
    return new Response(JSON.stringify(routes[key]!()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("飞书配置", () => {
  it("三项凭证齐全才算 configured", () => {
    expect(isFeishuConfigured({ ...cfg })).toBe(true);
    expect(isFeishuConfigured({ ...cfg, folderToken: undefined })).toBe(false);
    expect(isFeishuConfigured({ ...cfg, appSecret: undefined })).toBe(false);
  });

  it("baseUrl 去尾斜杠、默认国内站", () => {
    const prev = process.env.DIGGO_FEISHU_BASE_URL;
    process.env.DIGGO_FEISHU_BASE_URL = "https://example.com/";
    expect(resolveFeishuConfig().baseUrl).toBe("https://example.com");
    delete process.env.DIGGO_FEISHU_BASE_URL;
    expect(resolveFeishuConfig().baseUrl).toBe("https://open.feishu.cn");
    if (prev !== undefined) process.env.DIGGO_FEISHU_BASE_URL = prev;
  });
});

describe("飞书 client", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => _resetTokenCache());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("uploadDocx 返回 file_token", async () => {
    globalThis.fetch = stubFetch({
      "/drive/v1/files/upload_all": () => ({ code: 0, data: { file_token: "ft-1" } }),
    }) as typeof fetch;
    const ft = await uploadDocx(cfg, Buffer.from("hi"), "标题.docx");
    expect(ft).toBe("ft-1");
  });

  it("createImportTask 返回 ticket", async () => {
    globalThis.fetch = stubFetch({
      "/drive/v1/import_tasks": () => ({ code: 0, data: { ticket: "tk-1" } }),
    }) as typeof fetch;
    const tk = await createImportTask(cfg, "ft-1", "标题.docx");
    expect(tk).toBe("tk-1");
  });

  it("pollImportTask 处理中→成功，返回 url/token", async () => {
    let calls = 0;
    globalThis.fetch = stubFetch({
      "/drive/v1/import_tasks/": () => {
        calls++;
        return calls < 2
          ? { code: 0, data: { result: { job_status: 2 } } }
          : { code: 0, data: { result: { job_status: 0, token: "doc-1", url: "https://feishu/doc-1" } } };
      },
    }) as typeof fetch;
    const r = await pollImportTask(cfg, "tk-1", { intervalMs: 0, sleep: async () => {} });
    expect(r).toEqual({ token: "doc-1", url: "https://feishu/doc-1" });
    expect(calls).toBe(2);
  });

  it("pollImportTask 任务失败时抛错带 job_error_msg", async () => {
    globalThis.fetch = stubFetch({
      "/drive/v1/import_tasks/": () => ({
        code: 0,
        data: { result: { job_status: 3, job_error_msg: "文件超限" } },
      }),
    }) as typeof fetch;
    await expect(
      pollImportTask(cfg, "tk-1", { intervalMs: 0, sleep: async () => {} }),
    ).rejects.toThrow("文件超限");
  });

  it("飞书 code!==0 抛带 code 的错误", async () => {
    globalThis.fetch = stubFetch({
      "/drive/v1/files/upload_all": () => ({ code: 1061045, msg: "permission denied" }),
    }) as typeof fetch;
    await expect(uploadDocx(cfg, Buffer.from("x"), "a.docx")).rejects.toThrow("1061045");
  });
});
