import { describe, it, expect, afterEach } from "vitest";
import { startFake, closeAllFakes, ok } from "./testFake.ts";
import { testConnection } from "./testConnection.ts";
import type { ResolvedAIConfig } from "./aiConfig.ts";

afterEach(closeAllFakes);

const cfgFor = (baseUrl: string, extra: Partial<ResolvedAIConfig> = {}): ResolvedAIConfig => ({
  baseUrl,
  model: "m",
  imageSource: "grids",
  apiKey: "sk-secret",
  keySource: "saved",
  ready: true,
  ...extra,
});

describe("testConnection", () => {
  it("两步都成功且答出 red → ok、能看图、级别为 json_schema", async () => {
    const fake = await startFake((req) => (req.body.response_format ? ok('{"color":"Red"}') : ok("ok")));
    const r = await testConnection(cfgFor(fake.baseUrl));
    expect(r).toMatchObject({ ok: true, seesImage: true, structuredMode: "json_schema" });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.error).toBeUndefined();
    expect(fake.requests).toHaveLength(2);
    const step2 = fake.requests[1]!.body;
    expect(step2.response_format.json_schema.name).toBe("color_check");
    expect(JSON.stringify(step2.messages)).toContain("data:image/png;base64,");
  });

  it("第一步不带图片、不带 response_format", async () => {
    const fake = await startFake((req) => (req.body.response_format ? ok('{"color":"red"}') : ok("ok")));
    await testConnection(cfgFor(fake.baseUrl));
    const step1 = fake.requests[0]!.body;
    expect(step1.response_format).toBeUndefined();
    expect(JSON.stringify(step1.messages)).not.toContain("image_url");
    expect(JSON.stringify(step1.messages)).toContain("Reply with the single word: ok");
  });

  it("第一步 401 → 配置错误，不发第二步", async () => {
    const fake = await startFake(() => ({ status: 401, json: { error: { message: "bad key" } } }));
    const r = await testConnection(cfgFor(fake.baseUrl));
    expect(r).toMatchObject({ ok: false, seesImage: null, structuredMode: null });
    expect(fake.requests).toHaveLength(1);
    expect(r.error).toBeTruthy();
  });

  it("Gemini 式 400 无效 Key → 报配置错误而不是结构化级别问题", async () => {
    const fake = await startFake(() => ({
      status: 400,
      json: [{ error: { message: "API key not valid. Please pass a valid API key." } }],
    }));
    const r = await testConnection(cfgFor(fake.baseUrl));
    expect(r).toMatchObject({ ok: false, seesImage: null, structuredMode: null });
    expect(fake.requests).toHaveLength(1);
    expect(r.error).toContain("Key");
  });

  it("答错颜色 → ok 但 seesImage 为 false", async () => {
    const fake = await startFake((req) => (req.body.response_format ? ok('{"color":"blue"}') : ok("ok")));
    const r = await testConnection(cfgFor(fake.baseUrl));
    expect(r).toMatchObject({ ok: true, seesImage: false, structuredMode: "json_schema" });
  });

  it("json_schema 被拒 → structuredMode 为 json_object", async () => {
    const fake = await startFake((req) => {
      if (!req.body.response_format) return ok("ok");
      return req.body.response_format.type === "json_schema"
        ? { status: 400, json: { error: { message: "response_format not supported" } } }
        : ok('{"color":"red"}');
    });
    const r = await testConnection(cfgFor(fake.baseUrl));
    expect(r).toMatchObject({ ok: true, seesImage: true, structuredMode: "json_object" });
  });

  it("第二步内容不是 JSON → seesImage false，ok 仍为 true", async () => {
    const fake = await startFake((req) => (req.body.response_format ? ok("it is red") : ok("ok")));
    const r = await testConnection(cfgFor(fake.baseUrl));
    expect(r).toMatchObject({ ok: true, seesImage: false, structuredMode: "json_schema" });
  });

  it("第二步内容包在 ```json 代码块里也能解析", async () => {
    const fake = await startFake((req) =>
      JSON.stringify(req.body.messages).includes("image_url") ? ok('```json\n{"color":"red"}\n```') : ok("ok"),
    );
    const r = await testConnection(cfgFor(fake.baseUrl, { structuredMode: "none" }));
    expect(r).toMatchObject({ ok: true, seesImage: true, structuredMode: "none" });
  });

  it("未就绪（缺 Key）→ 不发任何请求", async () => {
    const fake = await startFake(() => ok("ok"));
    const r = await testConnection(cfgFor(fake.baseUrl, { ready: false, apiKey: undefined, keySource: "none" }));
    expect(r).toEqual({
      ok: false,
      seesImage: null,
      structuredMode: null,
      latencyMs: 0,
      error: "尚未配置该地址的 API Key",
    });
    expect(fake.requests).toHaveLength(0);
  });

  it("error 里不含 Key", async () => {
    const fake = await startFake(() => ({ status: 401, json: { error: { message: "bad key sk-secret" } } }));
    const r = await testConnection(cfgFor(fake.baseUrl));
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.error).not.toContain("sk-secret");
  });

  it("网络不通 → 不抛错，写进 error", async () => {
    const fake = await startFake(() => ok("ok"));
    const url = fake.baseUrl;
    await fake.close();
    const r = await testConnection(cfgFor(url));
    expect(r).toMatchObject({ ok: false, seesImage: null, structuredMode: null });
    expect(r.error).toBeTruthy();
  });
});
