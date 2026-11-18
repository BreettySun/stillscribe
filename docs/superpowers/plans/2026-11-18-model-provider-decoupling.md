# 模型服务解耦 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让最终用户在设置界面里自选模型服务（接口地址 + Key + 模型名），引擎只用 OpenAI 兼容的 `chat/completions` 一种接口调用模型，不再依赖 Gemini SDK。

**Architecture:** 引擎新增一个基于 `fetch` 的通用客户端，带三级结构化输出退路；非机密配置存 SQLite，Key 由 Electron 主进程用 `safeStorage` 按"地址 → Key"成表加密保存，经环境变量和一条只写路由交给引擎内存。界面新增设置对话框和"测试连接"。

**Tech Stack:** Node 22 自带 `fetch`、Fastify、better-sqlite3、vitest（引擎）；Electron `safeStorage` / IPC（主进程）；Vue 3 + Pinia + Naive UI（界面）。包管理 pnpm。

**Spec:** `docs/superpowers/specs/2026-11-18-model-provider-decoupling-design.md`（执行者须同时阅读）

## Global Constraints

- 不在 `main` 上直接提交：在分支 `feat/model-provider-decoupling` 上进行。
- 不引入任何厂商 SDK；HTTP 只用 Node 自带 `fetch`。
- Key 只放 `Authorization: Bearer <key>` 请求头；绝不进 URL、日志、SQLite、HTTP 响应、错误信息、渲染进程可读状态。
- 接口地址：协议必须 `https`；`http` 只允许回环地址（`localhost`、`127.0.0.1`、`[::1]`）。
- 默认值：地址 `https://generativelanguage.googleapis.com/v1beta/openai`，模型 `gemini-2.5-flash`，喂图方式 `grids`。
- 单次模型请求超时 300 秒；重试沿用 `engine/src/modules/m7/index.ts` 现有的 2 次，不另加一层。
- 引擎每条新路由都经现有鉴权钩子（`engine/src/server.ts` 的 `onRequest`），不得绕过。
- 渲染进程不用 `localStorage` / `sessionStorage`；保持 `contextIsolation: true`、`nodeIntegration: false`。
- 不重写提示词模板；不在运行时做任何图像编码（测试图是写死的常量）。
- 契约先行：先改 `shared/types.ts` 再改实现；涉及契约的提交说明里写明"契约变更"。
- 降级行为不变：全自动缺配置或失败时任务不失败，仍进入 `awaiting_review`。
- 常用命令：单文件测试 `pnpm --filter @stillscribe/engine exec vitest run <相对 engine/ 的路径>`；全量 `pnpm test`；类型检查 `pnpm typecheck`。

## Review Focus

规格没有写、但真实用户最容易踩到的五种情况。每条已在所属任务里补了测试：

1. 用户把完整端点（带 `/chat/completions` 后缀）粘进地址栏 → 应归一成基地址，而不是请求 `…/chat/completions/chat/completions` 得到 404。（Task 1）
2. 服务端返回 200 但 `choices` 为空或 `content` 为 `null`（内容过滤、长度截断）→ 应报"模型返回空响应"，而不是抛出看不懂的解析异常。（Task 2）
3. 地址填错，网关返回 200 的 HTML 页面 → 应报"地址不是模型服务接口"一类的配置错误，而不是"JSON 解析失败"。（Task 2）
4. Key 从网页复制时带了首尾空白或换行 → 保存前去掉；全是空白视为没填。（Task 4）
5. Key 含非 ASCII 字符（粘贴错了内容）→ `fetch` 设置请求头时会抛 `TypeError`，应转成配置错误，且信息里不含 Key。（Task 2）

---

### Task 1: 共享工具与新增契约类型

**Files:**
- Create: `shared/ai.ts`
- Modify: `shared/types.ts`（只做增量；`AISettings` 的形状在 Task 4 再改）
- Test: `engine/src/sharedAi.test.ts`

**Interfaces:**
- Produces（`shared/types.ts`）：
  ```ts
  export type AIModel = string;                       // 新名字；GeminiModel 暂时保留为它的别名，Task 11 删除
  export type AIStructuredMode = "json_schema" | "json_object" | "none";
  export type AIKeySource = "saved" | "env" | "none";
  export interface AISettingsPatch { baseUrl?: string; model?: string; imageSource?: AIImageSource }
  export interface AIKeyUpdate { baseUrl: string; apiKey: string | null }   // null = 清除
  export interface AITestResult {
    ok: boolean;
    seesImage: boolean | null;                 // 第一步就失败时为 null
    structuredMode: AIStructuredMode | null;
    latencyMs: number;
    error?: string;
  }
  // Task 接口新增可选字段：
  //   /** 全自动生成失败（已降级人工回填）的原因；成功得到文章后清空。 */
  //   autoError?: string;
  ```
- Produces（`shared/ai.ts`）：
  ```ts
  export const DEFAULT_AI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
  export type NormalizeResult = { ok: true; baseUrl: string } | { ok: false; error: string };
  export function normalizeBaseUrl(input: string): NormalizeResult;
  export function isLoopbackBaseUrl(baseUrl: string): boolean;
  export type AIKeyTable = Record<string, string>;           // 规范化地址 → Key
  export function parseKeyTable(json: string | undefined): AIKeyTable;
  export function withKey(table: AIKeyTable, baseUrl: string, apiKey: string | null): AIKeyTable;  // 返回新表
  export function mergeLegacyKey(table: AIKeyTable, legacyKey: string | undefined): AIKeyTable;
  export interface AIPreset { id: string; label: string; baseUrl: string; defaultModel: string }
  export const AI_PRESETS: readonly AIPreset[];   // 只有一项：{ id:"gemini", label:"Google Gemini", baseUrl: DEFAULT_AI_BASE_URL, defaultModel:"gemini-2.5-flash" }
  ```

- [ ] **Step 1: 写失败的测试** `engine/src/sharedAi.test.ts`

  ```ts
  describe("normalizeBaseUrl", () => {
    it.each([
      ["https://api.example.com/v1", "https://api.example.com/v1"],
      ["  https://api.example.com/v1/  ", "https://api.example.com/v1"],
      ["https://api.example.com/v1/chat/completions", "https://api.example.com/v1"],   // Review Focus 1
      ["https://api.example.com/v1/chat/completions/", "https://api.example.com/v1"],
      ["http://localhost:11434/v1", "http://localhost:11434/v1"],
      ["http://127.0.0.1:8080/v1", "http://127.0.0.1:8080/v1"],
      ["http://[::1]:8080/v1", "http://[::1]:8080/v1"],
    ])("接受并归一 %j", (input, want) => {
      expect(normalizeBaseUrl(input)).toEqual({ ok: true, baseUrl: want });
    });
    it.each(["", "   ", "not a url", "ftp://x.com/v1", "http://api.example.com/v1", "http://192.168.1.5:11434/v1"])(
      "拒绝 %j", (input) => { expect(normalizeBaseUrl(input).ok).toBe(false); });
  });
  describe("isLoopbackBaseUrl", () => {
    it("回环为真，其余为假", () => {
      expect(isLoopbackBaseUrl("http://localhost:11434/v1")).toBe(true);
      expect(isLoopbackBaseUrl("https://api.example.com/v1")).toBe(false);
    });
  });
  describe("Key 表", () => {
    it("parseKeyTable 对非法输入返回空表", () => {
      for (const bad of [undefined, "", "not json", "[]", "null", '{"a":1}']) expect(parseKeyTable(bad)).toEqual({});
    });
    it("parseKeyTable 丢弃非字符串值和不合法的地址键", () => {
      expect(parseKeyTable('{"https://a.com/v1":"k1","http://evil.com":"k2","https://b.com/v1":5}'))
        .toEqual({ "https://a.com/v1": "k1" });
    });
    it("withKey 写入、覆盖、清除，且不改原表", () => {
      const t0: AIKeyTable = {};
      const t1 = withKey(t0, "https://a.com/v1", "k1");
      expect(t0).toEqual({});
      expect(withKey(t1, "https://a.com/v1", null)).toEqual({});
    });
    it("mergeLegacyKey 把旧 Key 记到默认地址，但不覆盖已有的", () => {
      expect(mergeLegacyKey({}, "old")).toEqual({ [DEFAULT_AI_BASE_URL]: "old" });
      expect(mergeLegacyKey({ [DEFAULT_AI_BASE_URL]: "new" }, "old")).toEqual({ [DEFAULT_AI_BASE_URL]: "new" });
      expect(mergeLegacyKey({}, undefined)).toEqual({});
    });
  });
  ```

- [ ] **Step 2: 运行确认失败** — `pnpm --filter @stillscribe/engine exec vitest run src/sharedAi.test.ts`，预期：找不到 `@shared/ai`。
- [ ] **Step 3: 在 `shared/types.ts` 加上述类型**（`GeminiModel` 改为 `export type GeminiModel = AIModel;` 并标 `@deprecated`；`Task` 加 `autoError?: string`；`AI_DEFAULTS` 暂不动）。另把 `pnpm-workspace.yaml` 第一行注释里的"shared/ 仅类型"改为"shared/ 为类型与少量无依赖的纯函数"。
- [ ] **Step 4: 实现 `shared/ai.ts`**。`normalizeBaseUrl` 顺序：去空白 → `new URL` 解析 → 校验协议 → 去掉结尾的 `/chat/completions` → 去结尾 `/`；返回值不带 query 和 hash。本文件不得 import 任何 Node 或浏览器专有模块（引擎、主进程、界面三端共用）。
- [ ] **Step 5: 运行确认通过**，再跑 `pnpm typecheck`，预期全部通过。
- [ ] **Step 6: Commit** — `feat(shared): 模型服务地址规范化、Key 表与新增契约类型（契约变更：新增 AI* 类型与 Task.autoError）`

---

### Task 2: 通用聊天接口客户端（HTTP、退路、错误）

**Files:**
- Create: `engine/src/modules/m7/chat.ts`
- Test: `engine/src/modules/m7/chat.test.ts`

**Interfaces:**
- Consumes: `AIStructuredMode`（Task 1）。
- Produces：
  ```ts
  export type ChatPart = { type: "text"; text: string } | { type: "image"; base64: string; mimeType: string };
  export type AIErrorKind = "config" | "not_found" | "rate_limit" | "rejected" | "empty" | "server" | "network";
  export class AIRequestError extends Error {
    constructor(readonly kind: AIErrorKind, message: string, readonly status?: number);
  }
  export interface ChatOptions { baseUrl: string; apiKey?: string; model: string; timeoutMs?: number }  // timeoutMs 默认 300_000
  export function chatText(opts: ChatOptions, parts: ChatPart[]): Promise<string>;   // 不带 response_format，只发一次
  export function chatJson(
    opts: ChatOptions,
    req: { parts: ChatPart[]; schema: { name: string; schema: object }; startMode?: AIStructuredMode },
  ): Promise<{ content: string; mode: AIStructuredMode }>;
  ```
- 请求体：`{ model, messages: [{ role: "user", content: [...] }], response_format? }`；文本 part → `{ type:"text", text }`；图片 part → `{ type:"image_url", image_url:{ url: "data:<mime>;base64,<data>" } }`。
- `response_format`：`json_schema` → `{ type:"json_schema", json_schema:{ name, schema } }`（不加 `strict`）；`json_object` → `{ type:"json_object" }`；`none` → 不带该字段。
- 状态码 → `kind`：401/403 → `config`；400/422 且响应文本匹配 `/api[\s_-]?key|unauthori[sz]ed|authenticat|permission/i` → `config`；其余 400/422 → `rejected`；404 → `not_found`；429 → `rate_limit`；5xx → `server`；`fetch` 抛错或超时 → `network`；200 但拿不到非空 `choices[0].message.content` → `empty`；200 但响应体不是 JSON → `not_found`。
- 退路：从 `startMode ?? "json_schema"` 开始；只有 `rejected` 才降一级重试；三级都 `rejected` 时抛出**第一次**的错误。
- 服务端错误原文取 `error.message`，要同时认两种外形：`{ error: { message } }` 和 Gemini 兼容层的 `[{ error: { message } }]`；取不到就用响应文本前 300 字符。`rejected` 的 `message` 里要包含它。

- [ ] **Step 1: 写失败的测试** `engine/src/modules/m7/chat.test.ts`。文件内自带助手 `startFake(handler)`：用 `node:http` 在 `127.0.0.1:0` 起服务，记录每个请求的 `{ url, headers, body }`，返回 `{ baseUrl, requests, close }`。

  ```ts
  const ok = (content: string) => ({ status: 200, json: { choices: [{ message: { content } }] } });
  const SCHEMA = { name: "t", schema: { type: "object" } };
  const PARTS: ChatPart[] = [{ type: "text", text: "p" }, { type: "image", base64: "QUJD", mimeType: "image/png" }];

  it("请求形状：路径、Key 只在请求头、图片为 data URL", async () => {
    // 假服务恒返回 ok("{}")；调用 chatJson({ baseUrl, apiKey: "sk-test", model: "m" }, { parts: PARTS, schema: SCHEMA })
    expect(req.url).toBe("/chat/completions");
    expect(req.headers.authorization).toBe("Bearer sk-test");
    expect(req.url).not.toContain("sk-test");
    expect(req.body.model).toBe("m");
    expect(req.body.messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } });
    expect(req.body.response_format.type).toBe("json_schema");
    expect(req.body.response_format.json_schema.strict).toBeUndefined();
  });
  it("没有 Key 时不带 Authorization 请求头", ...);          // expect(req.headers.authorization).toBeUndefined()
  it("json_schema 被 400 拒绝 → 降到 json_object 并成功", ...);
      // 假服务：带 json_schema 的请求返回 400 {error:{message:"response_format not supported"}}，其余 ok
      // expect(result.mode).toBe("json_object"); expect(requests).toHaveLength(2)
  it("三级都被拒绝 → 抛出第一次的错误原文", ...);
      // 三次分别返回 400 "first" / "second" / "third"
      // await expect(p).rejects.toMatchObject({ kind: "rejected" }); expect(err.message).toContain("first")
  it("startMode=none 时只发一次且不带 response_format", ...);
  it.each([[401, "config"], [403, "config"], [404, "not_found"], [429, "rate_limit"], [500, "server"]])(
    "HTTP %i → kind %s，且不降级", ...);                      // expect(requests).toHaveLength(1)
  it("Gemini 兼容层的无效 Key：400 + 数组外形 → config，不降级", ...);
      // 返回 400，body: [{ error: { code: 400, message: "Please pass a valid API key", status: "INVALID_ARGUMENT" } }]
      // expect(err.kind).toBe("config"); expect(requests).toHaveLength(1)
  it("200 但 choices 为空 / content 为 null → empty", ...);   // Review Focus 2，两种都测
  it("200 但响应是 HTML → not_found", ...);                   // Review Focus 3：返回 "<html>login</html>"
  it("Key 含非 ASCII → config，信息里不含 Key", ...);         // Review Focus 5：apiKey: "密钥abc"
      // expect(err.kind).toBe("config"); expect(err.message).not.toContain("密钥abc")
  it("连不上 → network", ...);                                // baseUrl 指向已关闭的端口
  it("超时 → network", ...);                                  // 假服务不响应，timeoutMs: 50
  it("所有错误信息都不含 Key", ...);                          // 对上面各类错误断言 message 不含 "sk-test"
  it("chatText 不带 response_format 并返回文本", ...);
  ```

- [ ] **Step 2: 运行确认失败** — `pnpm --filter @stillscribe/engine exec vitest run src/modules/m7/chat.test.ts`
- [ ] **Step 3: 实现 `chat.ts`**。超时用 `AbortSignal.timeout`。错误信息用中文，至少让人分得清：Key 或配置被拒绝、地址或模型名不对、被限流、服务端拒绝了请求内容（附原文）、模型返回空响应、服务端出错、连不上。
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat(engine): 通用 chat/completions 客户端（三级结构化退路与错误分类）`

---

### Task 3: 文章客户端切到通用接口，移除 Gemini SDK

做完这一步，引擎已经完全通过通用接口工作（配置仍只读环境变量）。

**Files:**
- Create: `engine/src/modules/m7/articleClient.ts`
- Delete: `engine/src/modules/m7/geminiClient.ts`、`engine/scripts/gemini-smoke.ts`、`engine/scripts/spike-openai-compat.ts`
- Create: `engine/scripts/ai-smoke.ts`
- Modify: `engine/src/modules/m7/schema.ts`、`engine/src/modules/m7/parse.ts`、`engine/src/modules/m7/index.ts`、`engine/src/modules/m7/config.ts`、`engine/src/orchestrator/pipeline.ts`、`engine/src/orchestrator/queue.ts`、`engine/src/run.ts`、`engine/package.json`、`pnpm-workspace.yaml`
- Test: `engine/src/modules/m7/articleClient.test.ts`；修改 `engine/src/modules/m7/m7.test.ts`、`engine/src/modules/m7/generate.e2e.test.ts`

**Interfaces:**
- Consumes: `chatJson`、`ChatOptions`、`ChatPart`、`AIRequestError`（Task 2）；`DEFAULT_AI_BASE_URL`（Task 1）。
- Produces：
  ```ts
  // articleClient.ts
  export interface GenerateArticleInput { images: ImagePart[]; subtitles: string; prompt: string }   // 原样迁移
  export interface ArticleClient { generateArticle(input: GenerateArticleInput): Promise<Article> }
  export interface ArticleClientOptions extends ChatOptions {
    structuredMode?: AIStructuredMode;                      // 已记住的级别
    onStructuredMode?(mode: AIStructuredMode): void;        // 每次成功后回报实际用上的级别
  }
  export function createArticleClient(opts: ArticleClientOptions): ArticleClient;
  // schema.ts
  export const articleJsonSchema: object;                   // 标准 JSON Schema，type 全小写；取代 articleResponseSchema
  ```
- 发送顺序与现在一致：提示词文本、字幕文本、各图片。`chatJson` 的 schema 名固定为 `"article"`。

- [ ] **Step 1: 写失败的测试** `articleClient.test.ts`（沿用 Task 2 的 `startFake` 写法，可把它抽到 `engine/src/modules/m7/testFake.ts` 共用）

  ```ts
  const ARTICLE = { pages: [{ subhead: "s", image: "00_00_01", body: "b" }], meta: { titles: ["t"], keywords: ["k"], description: "d" } };
  it("按 提示词→字幕→图片 的顺序发送，并返回校验过的 Article", ...);
      // content[0].text === "PROMPT"; content[1].text === "SUBS"; content[2].type === "image_url"
      // expect(article).toEqual(ARTICLE)
  it("把 Article 的 JSON Schema 以 name=article 传给服务端", ...);
      // expect(req.body.response_format.json_schema.name).toBe("article")
      // expect(req.body.response_format.json_schema.schema).toEqual(articleJsonSchema)
  it("成功后经 onStructuredMode 回报实际级别", ...);       // 假服务拒绝 json_schema → 回报 "json_object"
  it("从 structuredMode 指定的级别开始", ...);             // structuredMode:"json_object" → 第一个请求就是 json_object
  it("内容不是合法 Article → 抛错", ...);                  // content: '{"pages":[]}' 缺 meta
  it("内容包在 ```json 围栏里也能解析", ...);
  ```
  同时把 `m7.test.ts` 里 `articleResponseSchema` 那组断言改为针对 `articleJsonSchema`，并加一条：
  ```ts
  it("全部 type 为小写的标准 JSON Schema", () => {
    expect(JSON.stringify(articleJsonSchema)).not.toMatch(/"type":"[A-Z]/);
    expect((articleJsonSchema as any).type).toBe("object");
  });
  ```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 改写 `schema.ts`**：内容不变，只把 `type` 值改小写、导出名改为 `articleJsonSchema`，文件头注释去掉 Gemini 方言的说明。
- [ ] **Step 4: 实现 `articleClient.ts`，删除 `geminiClient.ts`**，把 `index.ts`、`pipeline.ts`、`generate.e2e.test.ts` 里的 `GeminiClient` / `createGeminiClient` 全部换成 `ArticleClient` / `createArticleClient`。
- [ ] **Step 5: 过渡性地改 `config.ts`**：`ResolvedAIConfig` 增加 `baseUrl`，取 `process.env.STILLSCRIBE_AI_BASE_URL || DEFAULT_AI_BASE_URL`；`queue.ts` 与 `run.ts` 构造客户端时传入它。（本文件在 Task 4 被整体替换。）
- [ ] **Step 6: 文案去厂商化（引擎侧）**：`parse.ts` 的 "Gemini 返回空响应 / 非 JSON" 改为 "模型返回…"；`index.ts` 的进度与错误文案改为 `调用模型 ${model} 生成文章…` / `模型生成失败（重试 N 次）: …`（为此给 `index.ts` 的 `GenerateOptions` 和 `pipeline.ts` 的 `ArticleDeps` 各加可选 `modelLabel?: string`，`runArticle` 透传，`queue.ts` / `run.ts` 传入当前模型名）；`pipeline.ts` 的 "调用 Gemini 生成文章…" 改为 "调用模型生成文章…"；`run.ts`、`queue.ts` 的提示同理。若现有测试断言了旧文案，同步更新。
- [ ] **Step 7: 写 `engine/scripts/ai-smoke.ts`**：读环境配置，对当前地址用 `createArticleClient` 发一次最小请求（沿用旧冒烟脚本的提示词与 1×1 PNG 常量），打印返回的 Article。`engine/package.json` 的脚本名 `gemini-smoke` 改为 `ai-smoke`。
- [ ] **Step 8: 移除 SDK**：`engine/package.json` 删除 `@google/genai`；`pnpm-workspace.yaml` 的 `allowBuilds` 里删除 `'@google/genai': false`；运行 `pnpm install` 后执行 `pnpm why protobufjs`，若已无任何包依赖它，把 `protobufjs: false` 一并删除，否则保留。
- [ ] **Step 9: 运行** `pnpm test && pnpm typecheck`，预期全部通过；`grep -rn "@google/genai" engine/src engine/scripts engine/package.json` 预期无输出。
- [ ] **Step 10: Commit** — `feat(engine): M7 改走通用接口并移除 @google/genai`

---

### Task 4: 配置与 Key 表（引擎）

**Files:**
- Create: `engine/src/modules/m7/aiConfig.ts`
- Delete: `engine/src/modules/m7/config.ts`
- Modify: `shared/types.ts`（`AISettings`、`AI_DEFAULTS` 定型）、`engine/src/orchestrator/queue.ts`、`engine/src/run.ts`、`engine/src/serve.ts`、`engine/src/server.ts`、`engine/scripts/ai-smoke.ts`、`ui/src/components/submit/SubmitForm.vue`（仅为通过类型检查，改读 `ready`）
- Test: `engine/src/modules/m7/aiConfig.test.ts`

**Interfaces:**
- Consumes: Task 1 的全部导出；`SettingsStore`（`engine/src/store/settings.ts`，构造参数可用 `":memory:"`）。
- Produces（`shared/types.ts`）：
  ```ts
  export interface AISettings {
    baseUrl: string;
    model: AIModel;
    imageSource: AIImageSource;
    hasApiKey: boolean;             // 当前地址是否有 Key
    keySource: AIKeySource;         // 当前地址 Key 的来源
    ready: boolean;                 // hasApiKey || 当前地址是回环地址
    keyedBaseUrls: string[];        // 所有已有 Key 的地址（含来自环境变量的）
  }
  export const AI_DEFAULTS: Pick<AISettings, "baseUrl" | "model" | "imageSource">;  // baseUrl 用默认地址的字面量
  ```
  `shared/ai.ts` 的 `DEFAULT_AI_BASE_URL` 改为 `AI_DEFAULTS.baseUrl` 的再导出，保证只有一处字面量。
- Produces（`aiConfig.ts`）：
  ```ts
  export interface ResolvedAIConfig {
    baseUrl: string; model: AIModel; imageSource: AIImageSource;
    apiKey?: string; keySource: AIKeySource; ready: boolean; structuredMode?: AIStructuredMode;
  }
  export class AIConfigError extends Error {}
  export class AIConfig {
    constructor(env: NodeJS.ProcessEnv, settings?: SettingsStore);   // 无 settings = 只读环境变量（命令行入口用）
    resolve(): ResolvedAIConfig;
    read(): AISettings;
    save(patch: AISettingsPatch): AISettings;                         // 非法值抛 AIConfigError
    setKey(update: AIKeyUpdate): AISettings;                          // 非法地址抛 AIConfigError
    rememberStructuredMode(baseUrl: string, model: string, mode: AIStructuredMode): void;
  }
  ```
- `kv_settings` 的键：`ai.baseUrl`、`ai.model`、`ai.imageSource`、`ai.structuredModes`（JSON 对象，键为 `` `${baseUrl}\n${model}` ``）。
- 取值优先级：SQLite 里用户保存的值 > 环境变量 > `AI_DEFAULTS`。环境变量：地址 `STILLSCRIBE_AI_BASE_URL`；模型 `STILLSCRIBE_AI_MODEL`，其次旧名 `STILLSCRIBE_GEMINI_MODEL`；喂图 `STILLSCRIBE_AI_IMAGE_SOURCE`。
- Key 来源（构造时读一次环境变量，之后只在内存里变）：
  - 表：`parseKeyTable(env.STILLSCRIBE_AI_KEYS)`，加上运行中 `setKey` 写入的 → 来源 `"saved"`。
  - 环境单 Key：`STILLSCRIBE_AI_API_KEY` 属于 `STILLSCRIBE_AI_BASE_URL`（未设则默认地址）；旧名 `STILLSCRIBE_GEMINI_API_KEY` 属于默认地址 → 来源 `"env"`。
  - 同一地址两者都有时用表里的。`setKey(null)` 只删表里的条目。
- Key 永不写入 `SettingsStore`。

- [ ] **Step 1: 写失败的测试** `aiConfig.test.ts`

  ```ts
  const mem = () => new SettingsStore(":memory:");
  it("全空时用默认值，未就绪", () => {
    expect(new AIConfig({}, mem()).read()).toEqual({
      baseUrl: AI_DEFAULTS.baseUrl, model: "gemini-2.5-flash", imageSource: "grids",
      hasApiKey: false, keySource: "none", ready: false, keyedBaseUrls: [],
    });
  });
  it("优先级：保存的值 > 环境变量 > 默认", ...);
      // env: STILLSCRIBE_AI_MODEL="env-m" → read().model === "env-m"；save({model:"saved-m"}) 后为 "saved-m"
  it("旧环境变量仍可用：GEMINI_API_KEY 属于默认地址，GEMINI_MODEL 作模型兜底", ...);
      // read() → hasApiKey true, keySource "env", ready true, keyedBaseUrls [AI_DEFAULTS.baseUrl]
  it("STILLSCRIBE_AI_API_KEY 属于 STILLSCRIBE_AI_BASE_URL", ...);
  it("STILLSCRIBE_AI_KEYS 非法 JSON → 视为空表，不抛错", ...);
  it("Key 与地址绑定：换地址后旧 Key 不可用，切回后恢复", () => {
    const c = new AIConfig({}, mem());
    c.setKey({ baseUrl: "https://a.com/v1", apiKey: "ka" });
    c.save({ baseUrl: "https://a.com/v1" });
    expect(c.resolve().apiKey).toBe("ka");
    c.save({ baseUrl: "https://b.com/v1" });
    expect(c.resolve().apiKey).toBeUndefined();
    expect(c.read().ready).toBe(false);
    c.save({ baseUrl: "https://a.com/v1" });
    expect(c.resolve().apiKey).toBe("ka");
  });
  it("表里的 Key 优先于环境变量；清除后回落到环境变量", ...);
      // env GEMINI_API_KEY="envk"；setKey(默认地址,"saved") → "saved"/"saved"；setKey(默认地址,null) → "envk"/"env"
  it("回环地址没有 Key 也算就绪", ...);                     // save({baseUrl:"http://localhost:11434/v1"}) → ready true, hasApiKey false
  it("setKey 去掉首尾空白；全空白等同清除", ...);           // Review Focus 4：" k1\n" → "k1"；"   " → 该地址无 Key
  it("save 对地址做规范化，拒绝非法值", ...);
      // save({baseUrl:"https://a.com/v1/"}) → read().baseUrl === "https://a.com/v1"
      // save({baseUrl:"http://a.com/v1"})、save({model:"  "})、save({imageSource:"x" as any}) 都抛 AIConfigError
  it("read() 与 SettingsStore 里都不出现 Key", ...);
      // JSON.stringify(c.read()) 不含 "ka"；对 mem() 遍历 ai.* 四个键的值都不含 "ka"
  it("结构化级别按（地址, 模型）记忆", ...);
      // rememberStructuredMode(A,"m1","json_object") 后：地址 A 模型 m1 时 resolve().structuredMode === "json_object"；换模型或换地址为 undefined
  it("无 settings 时也可用（命令行入口），save / remember 只在内存生效", ...);
  ```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 改 `shared/types.ts` 的 `AISettings` 与 `AI_DEFAULTS`**，并更新路由说明注释里 `GET /settings/ai` 一行。
- [ ] **Step 4: 实现 `aiConfig.ts`，删除 `config.ts`**。
- [ ] **Step 5: 接线**
  - `queue.ts`：`OrchestratorOptions` 加 `ai?: AIConfig`，缺省为 `new AIConfig(process.env)`。`tryAutoArticle` 改为每次调用 `this.ai.resolve()`；`!cfg.ready` 时走原来的"未配置"降级；构造 `createArticleClient` 时传 `baseUrl / apiKey / model / structuredMode`，`onStructuredMode` 接到 `this.ai.rememberStructuredMode(cfg.baseUrl, cfg.model, mode)`。
  - `serve.ts`：`const ai = new AIConfig(process.env, settings)`，传给 `Orchestrator` 和 `buildServer`。
  - `server.ts`：`ServerDeps` 加 `ai: AIConfig`；`GET /settings/ai` 返回 `ai.read()`。
  - `run.ts`、`ai-smoke.ts`：改用 `new AIConfig(process.env).resolve()`，未就绪时的提示改为 "需在 engine/.env 配置 STILLSCRIBE_AI_API_KEY"。
  - `SubmitForm.vue`：`aiHasKey.value = (await api.getAISettings()).ready`（变量改名留到 Task 10）。
- [ ] **Step 6: 运行** `pnpm test && pnpm typecheck`，预期全部通过。
- [ ] **Step 7: Commit** — `feat(engine): 模型服务配置与按地址绑定的 Key 表（契约变更：AISettings 增加 baseUrl/keySource/ready/keyedBaseUrls）`

---

### Task 5: 全自动失败原因落到任务上

**Files:**
- Modify: `engine/src/store/tasks.ts`、`engine/src/orchestrator/queue.ts`
- Test: `engine/src/store/tasks.test.ts`、新建 `engine/src/orchestrator/queue.auto.test.ts`

**Interfaces:**
- Consumes: `Task.autoError`（Task 1）、`AIConfig`（Task 4）。
- Produces: `TaskPatch.autoError?: string | null`（`null` 清空）；`tasks` 表新增列 `autoError TEXT`，旧库用与 `outputs` 列相同的 `PRAGMA table_info` + `ALTER TABLE` 方式补列。

- [ ] **Step 1: 写失败的测试**

  `tasks.test.ts` 追加：
  ```ts
  it("autoError 可写入、读取、清空", () => {
    // update(id,{autoError:"x"}) → get(id).autoError === "x"；update(id,{autoError:null}) → 字段不存在
  });
  it("旧库缺 autoError 列时自动补上", ...);   // 参照文件里对 outputs 列迁移的现有测试写法
  ```
  `queue.auto.test.ts`：按 `queue.info.test.ts` 的方式 `vi.mock("./pipeline.ts")`，让 `runToGrids` 直接 resolve，`runArticle` 由各用例控制。
  ```ts
  it("未就绪 → 任务进入 awaiting_review，autoError 说明未配置 Key", ...);
      // new AIConfig({})；mode:"auto"；等到 status === "awaiting_review"
      // expect(task.autoError).toMatch(/Key/); expect(task.article).toBeUndefined(); expect(runArticle).not.toHaveBeenCalled()
  it("调用失败 → awaiting_review，autoError 为错误原因，任务不失败", ...);
      // runArticle 抛 new Error("地址或模型名不对")；expect(task.status).toBe("awaiting_review"); expect(task.autoError).toContain("地址或模型名不对")
  it("调用成功 → 有 article，无 autoError", ...);
  it("人工回填文章后清掉 autoError", ...);    // 先造成失败，再 orch.setArticle(id, ARTICLE) → autoError 不存在
  ```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**：`tasks.ts` 加列、迁移、`rowToTask`、`TaskPatch`、`update` 的合并与 SQL；`queue.ts` 的 `tryAutoArticle` 在两条降级路径上写 `autoError`（未就绪时文案："模型服务未配置 API Key，已转为人工回填"），成功时写 `autoError: null`；`setArticle` 同时写 `autoError: null`。stderr 日志保留。
- [ ] **Step 4: 运行确认通过**，再跑 `pnpm test`。
- [ ] **Step 5: Commit** — `feat(engine): 全自动失败原因记录到任务（契约变更：Task.autoError 落库）`

---

### Task 6: 设置路由

**Files:**
- Modify: `engine/src/server.ts`、`shared/types.ts`（路由说明注释）
- Test: 新建 `engine/src/server.ai.test.ts`

**Interfaces:**
- Consumes: `AIConfig`、`AIConfigError`（Task 4）；`AISettingsPatch`、`AIKeyUpdate`（Task 1）。
- Produces：
  - `POST /settings/ai`，body `AISettingsPatch` → `AISettings`
  - `PUT /settings/ai/key`，body `AIKeyUpdate` → `AISettings`
  - `AIConfigError` 以及 body 形状不对 → 400。

- [ ] **Step 1: 写失败的测试** `server.ai.test.ts`。助手 `makeApp()`：用 `:memory:` 的 `TaskStore` 与 `SettingsStore`、`new EventBus()`、`new AIConfig({}, settings)`、`new Orchestrator(...)`、`auth: { token: "t", allowedOrigins: [] }` 调 `buildServer`；请求用 `app.inject`，默认带 `authorization: "Bearer t"` 和 `host: "127.0.0.1"`。

  ```ts
  it.each([["GET", "/settings/ai"], ["POST", "/settings/ai"], ["PUT", "/settings/ai/key"]])("%s %s 不带令牌 → 401", ...);
  it("POST /settings/ai 保存并返回规范化后的设置", ...);
      // payload {baseUrl:"https://a.com/v1/", model:"m1", imageSource:"frames"} → 200，body.baseUrl === "https://a.com/v1"
      // 随后 GET /settings/ai 返回相同内容
  it.each([{ baseUrl: "http://a.com/v1" }, { model: "" }, { imageSource: "x" }, { baseUrl: 5 }])("非法值 %j → 400", ...);
  it("PUT /settings/ai/key 写入后 hasApiKey 为真，响应里不含 Key", ...);
      // payload {baseUrl: AI_DEFAULTS.baseUrl, apiKey:"sk-secret"} → 200
      // expect(res.body).not.toContain("sk-secret"); expect(json.hasApiKey).toBe(true); expect(json.keySource).toBe("saved")
  it("PUT /settings/ai/key apiKey=null 清除", ...);
  it.each([{}, { baseUrl: "https://a.com/v1" }, { baseUrl: "http://a.com/v1", apiKey: "k" }, { baseUrl: "https://a.com/v1", apiKey: 5 }])(
    "PUT /settings/ai/key 非法 body %j → 400", ...);
  it("出错响应里也不回显请求体中的 Key", ...);
      // payload {baseUrl:"http://a.com/v1", apiKey:"sk-secret"} → 400 且 res.body 不含 "sk-secret"
  ```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现两条路由**，放在现有 `GET /settings/ai` 旁；`AIConfigError` 转 `HttpError(400, …)`；不在任何日志里输出请求体。更新 `shared/types.ts` 路由说明注释（去掉"只读；不经 HTTP 修改"的说法，列出新路由）。
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat(engine): 模型服务设置与 Key 写入路由（契约变更：新增 POST /settings/ai、PUT /settings/ai/key）`

---

### Task 7: 测试连接

**Files:**
- Create: `engine/src/modules/m7/testConnection.ts`
- Modify: `engine/src/server.ts`、`shared/types.ts`（路由说明注释）
- Test: `engine/src/modules/m7/testConnection.test.ts`；`engine/src/server.ai.test.ts` 追加用例

**Interfaces:**
- Consumes: `chatText`、`chatJson`、`AIRequestError`（Task 2）；`ResolvedAIConfig`（Task 4）；`AITestResult`（Task 1）。
- Produces：
  ```ts
  export function testConnection(cfg: ResolvedAIConfig): Promise<AITestResult>;   // 从不抛错，失败写进 error
  ```
  `POST /settings/ai/test`（无 body）→ `AITestResult`；测试用当前已保存的配置；`structuredMode` 非空时调 `ai.rememberStructuredMode`。
- 两步：
  1. `chatText`，一条文本 `Reply with the single word: ok`。失败 → `{ ok:false, seesImage:null, structuredMode:null, error }`，不进行第二步。
  2. `chatJson`，文本 `What is the dominant color of this image? Answer with one lowercase English word.` + 下面的测试图，schema 名 `color_check`，内容 `{ type:"object", properties:{ color:{ type:"string" } }, required:["color"] }`，`startMode` 取 `cfg.structuredMode`。返回内容解析出的 `color` 含 `red`（忽略大小写）→ `seesImage: true`，否则 `false`；内容解析失败 → `seesImage: false`。
- `ok` 为真当且仅当两步都没抛错；`seesImage` 为假不影响 `ok`（由界面单独提示）。
- `latencyMs` 为两步合计。两步都用 `timeoutMs: 60_000`。
- 测试图常量（64×64 纯红 PNG，`mimeType: "image/png"`），原样写入代码：
  ```
  iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc8OJg6Ln3AAAAAElFTkSuQmCC
  ```

- [ ] **Step 1: 写失败的测试** `testConnection.test.ts`（用 `startFake`）

  ```ts
  it("两步都成功且答出 red → ok、能看图、级别为 json_schema", ...);
      // 第二步返回 content '{"color":"Red"}' → { ok:true, seesImage:true, structuredMode:"json_schema" }；latencyMs >= 0
  it("第一步不带图片、不带 response_format", ...);
  it("第一步 401 → 配置错误，不发第二步", ...);
      // expect(result).toMatchObject({ ok:false, seesImage:null, structuredMode:null }); expect(requests).toHaveLength(1); expect(result.error).toBeTruthy()
  it("Gemini 式 400 无效 Key → 报配置错误而不是结构化级别问题", ...);   // 第一步返回数组外形的 400
  it("答错颜色 → ok 但 seesImage 为 false", ...);          // '{"color":"blue"}'
  it("json_schema 被拒 → structuredMode 为 json_object", ...);
  it("第二步内容不是 JSON → seesImage false，ok 仍为 true", ...);
  it("error 里不含 Key", ...);
  ```
  `server.ai.test.ts` 追加：
  ```ts
  it("POST /settings/ai/test 不带令牌 → 401", ...);
  it("POST /settings/ai/test 返回 AITestResult 并记住结构化级别", ...);
      // 起一个 startFake，先 POST /settings/ai 把 baseUrl 指向它（回环 http 合法），再 POST /settings/ai/test
      // 假服务拒绝 json_schema → 响应 structuredMode === "json_object"，且 ai.resolve().structuredMode === "json_object"
  ```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现 `testConnection.ts` 与路由**，更新 `shared/types.ts` 路由说明注释。
- [ ] **Step 4: 运行确认通过**，再跑 `pnpm test && pnpm typecheck`。
- [ ] **Step 5: Commit** — `feat(engine): 模型服务测试连接（契约变更：新增 POST /settings/ai/test）`

---

### Task 8: Electron 主进程保存 Key

主进程没有测试框架；可测的逻辑都在 Task 1 的纯函数里，本任务只做薄封装，靠类型检查和 Task 12 的实机验证把关。

**Files:**
- Create: `electron/src/main/aiKeys.ts`
- Delete: `electron/src/main/apiKey.ts`
- Modify: `electron/src/main/index.ts`、`electron/src/preload/index.ts`、`ui/src/stillscribe.d.ts`

**Interfaces:**
- Consumes: `AIKeyTable`、`parseKeyTable`、`withKey`、`mergeLegacyKey`、`normalizeBaseUrl`（Task 1）；引擎的 `PUT /settings/ai/key`（Task 6）。
- Produces：
  ```ts
  // aiKeys.ts（都须在 app ready 之后调用）
  export function loadKeyTable(): AIKeyTable;
  export function saveKeyTable(table: AIKeyTable): boolean;      // 返回是否已落盘
  // preload 暴露、ui/src/stillscribe.d.ts 同步声明：
  setAIKey: (baseUrl: string, apiKey: string | null) => Promise<{ persisted: boolean }>;
  ```
- 文件都在 `app.getPath("userData")` 下：新 `ai-keys.enc`；旧 `gemini-key.enc`、`gemini-key.txt`。
- `loadKeyTable`：
  1. `ai-keys.enc` 存在且 `safeStorage` 可用 → 解密后 `parseKeyTable`；解密失败记一行 stderr 并当作空表。
  2. 旧 `gemini-key.enc`（需解密）或 `gemini-key.txt`（明文）存在 → `mergeLegacyKey`。
  3. 第 2 步改变了表 → `saveKeyTable`；**只有落盘成功才删除旧文件**。
  4. 不再有"未打包就直接返回"的短路：开发态同样生效。
- `saveKeyTable`：`safeStorage.isEncryptionAvailable()` 为假 → 返回 `false` 且不写任何文件；否则写 `safeStorage.encryptString(JSON.stringify(table))`，文件权限 `0o600`。
- `index.ts`：
  - 模块级 `let aiKeys: AIKeyTable = {}`，在 `app.whenReady()` 里原来调 `resolveGeminiKey()` 的位置改为 `aiKeys = loadKeyTable()`。
  - `startEngine` 的 env：删掉 `STILLSCRIBE_GEMINI_API_KEY` 注入，改为 `STILLSCRIBE_AI_KEYS: JSON.stringify(aiKeys)`（引擎崩溃重启时取到的是当前表）。
  - 新 IPC `ipcMain.handle("stillscribe:set-ai-key", (_e, baseUrl: unknown, apiKey: unknown) => …)`：校验 `baseUrl` 为字符串且 `normalizeBaseUrl` 通过、`apiKey` 为 `null` 或非空字符串，否则抛错 → `aiKeys = withKey(...)` → `persisted = saveKeyTable(aiKeys)` → 用 `engineAuthHeader` 调 `PUT ${引擎源}/settings/ai/key`，非 2xx 抛错 → 返回 `{ persisted }`。
  - Key 不写日志。

- [ ] **Step 1: 实现 `aiKeys.ts`，删除 `apiKey.ts`**
- [ ] **Step 2: 改 `index.ts`、`preload/index.ts`、`ui/src/stillscribe.d.ts`**
- [ ] **Step 3: 运行** `pnpm typecheck`，预期通过；`grep -rn "resolveGeminiKey\|geminiKey\|main/apiKey" electron/src` 预期无输出。
- [ ] **Step 4: Commit** — `feat(desktop): 按地址保存模型服务 Key（safeStorage），迁移旧 gemini-key 文件`

---

### Task 9: 设置对话框

界面没有组件测试框架；本任务以类型检查把关，行为在 Task 12 实机验证。

**Files:**
- Create: `ui/src/stores/ai.ts`、`ui/src/components/settings/AISettingsDialog.vue`
- Modify: `ui/src/api/client.ts`、`ui/src/bridge.ts`、`ui/src/components/AppShell.vue`

**Interfaces:**
- Consumes: Task 4/6/7 的路由与类型；`AI_PRESETS`、`normalizeBaseUrl`（Task 1）；`window.stillscribe.setAIKey`（Task 8）。
- Produces：
  ```ts
  // api/client.ts
  saveAISettings: (patch: AISettingsPatch) => Promise<AISettings>;   // POST /settings/ai
  testAI: () => Promise<AITestResult>;                               // POST /settings/ai/test
  // bridge.ts
  export const canStoreAIKey: boolean;                               // 仅 Electron 下为真
  export function setAIKey(baseUrl: string, apiKey: string | null): Promise<{ persisted: boolean }>;
  // stores/ai.ts
  export const useAIStore = defineStore("ai", () => ({
    settings: Ref<AISettings | null>,
    ready: ComputedRef<boolean>,                                     // settings?.ready ?? false
    load(): Promise<void>,
    save(patch: AISettingsPatch): Promise<void>,
    setKey(baseUrl: string, apiKey: string | null): Promise<{ persisted: boolean }>,   // 之后重新 load
    test(): Promise<AITestResult>,
  }));
  // AISettingsDialog.vue：props { show: boolean }，emits "update:show"
  ```

- [ ] **Step 1: `client.ts`、`bridge.ts`、`stores/ai.ts`**。`AppShell.vue` 的 `onMounted` 里与 `settings.load()` 并列调用 `ai.load()`。
- [ ] **Step 2: `AISettingsDialog.vue`**（Naive UI 的 `n-modal` + 表单），行为：
  - 打开时用 `store.settings` 填表单；表单是本地状态，点保存才生效。
  - "服务"下拉：`AI_PRESETS` 各项 + "自定义"。当前地址等于某预设的 `baseUrl` 即选中该预设，否则选"自定义"。选预设 → 地址填预设值且只读，模型填预设的 `defaultModel`；选"自定义" → 地址可编辑。
  - 地址输入时用 `normalizeBaseUrl` 即时校验，不合法显示其 `error` 并禁用两个保存按钮。
  - Key 输入框：`type="password"`，只写不回显。右侧状态按**表单里当前填的地址**（规范化后）判断：
    - 它等于 `settings.baseUrl` 且 `settings.keySource === "env"` → 显示"来自 engine/.env"，不给"清除"按钮；
    - 否则它在 `settings.keyedBaseUrls` 里 → 显示"已保存"和"清除"按钮（点击即 `setKey(该地址, null)`）；
    - 否则 → 显示"未设置"。
  - `canStoreAIKey` 为假（纯 Web）→ Key 输入框禁用，占位文字"开发模式下 Key 在 engine/.env 配置"。
  - 模型：文本输入，不能为空。
  - 喂图方式：单选 "宫格图" / "单帧（更准，费用更高）"。
  - "仅保存"：Key 输入框非空则先 `setKey(地址, key)`，再 `save({ baseUrl, model, imageSource })`。`persisted === false` 时提示"Key 未能保存到系统钥匙串，重启后需重填"。
  - "保存并测试"：同上，然后 `test()`，按钮显示加载中。
  - 结果行：成功 → `连接正常 · {能看图|不能看图} · {级别说明} · {秒数} 秒`；级别说明：`json_schema` → "支持强制结构"，`json_object` → "仅保证是 JSON"，`none` → "不支持强制输出格式，生成可能偶尔失败并转为人工回填"；`seesImage === false` 时另起一行警告"该模型无法识别图片，不适合本应用"；失败 → 显示 `error`。
  - 不使用 `localStorage` / `sessionStorage`。
- [ ] **Step 3: `AppShell.vue`**：标题栏"切换主题"按钮旁加一个同样式的图标按钮（`@vicons/ionicons5` 的 `SettingsOutline`，`aria-label="模型服务设置"`），点开对话框。
- [ ] **Step 4: 运行** `pnpm typecheck`，预期通过。
- [ ] **Step 5: Commit** — `feat(ui): 模型服务设置对话框与测试连接`

---

### Task 10: 提交表单、校对页与文案

**Files:**
- Modify: `ui/src/components/submit/SubmitForm.vue`、`ui/src/components/submit/AdvancedOptions.vue`、`ui/src/components/submit/PromptEditor.vue`、`ui/src/components/review/ReviewView.vue`

**Interfaces:**
- Consumes: `useAIStore().ready`（Task 9）；`Task.autoError`（Task 5）。

- [ ] **Step 1: 全自动是否可选改为响应式**：`SubmitForm.vue` 去掉本地的 `aiHasKey` 与对应的 `api.getAISettings()` 调用，改用 `useAIStore().ready`；`AdvancedOptions.vue` 的 prop `aiHasKey` 改名 `aiReady`。这样在设置里保存后，无需刷新 Auto 选项即可选。Auto 不可选时在该选项旁给出提示"请先在设置中配置模型服务"。
- [ ] **Step 2: 校对页显示失败原因**：`ReviewView.vue` 在 `!hasArticle && task.autoError` 时，于标题区下方显示一条 `n-alert`（`type="warning"`，不可关闭也不阻断操作），标题"自动生成失败，已转为人工回填"，正文为 `task.autoError` 加一句"可以在下方手动回填，或到设置里检查模型配置。"
- [ ] **Step 3: 文案去厂商化**：`ReviewView.vue` 的"宫格图 + 字幕交给 Gemini"改为"交给模型"；`PromptEditor.vue`、`AdvancedOptions.vue`、`SubmitForm.vue` 注释与界面文字里的 "Gemini" 全部改为"模型"或"模型服务"。
- [ ] **Step 4: 运行** `pnpm typecheck`；`grep -rn -i "gemini" ui/src` 预期无输出。
- [ ] **Step 5: Commit** — `feat(ui): 全自动就绪状态响应式、校对页显示失败原因、文案去厂商化`

---

### Task 11: 文档、规则与收尾

**Files:**
- Modify: `CLAUDE.md`、`README.md`、`SECURITY.md`、`CONTRIBUTING.md`、`THIRD_PARTY_NOTICES.md`、`engine/.env.example`、`docs/视频生成文章-架构文档.md`、`docs/视频生成文章-AI集成.md`、`shared/types.ts`、`ui/vite.config.ts`（注释）、`engine/src/env.ts`（注释）、`engine/src/serve.ts`（注释）、`engine/src/modules/m5-select.ts`（注释）、`engine/src/modules/m7/prompt.ts`（注释）

- [ ] **Step 1: `CLAUDE.md`**
  - §3 铁律 #6 的出站一句替换为规格第 4 节的原文："出站请求只允许 YouTube(yt-dlp) 与**用户在设置中配置的模型服务地址**（默认 Google Gemini）。API Key 与其接口地址绑定，绝不发往其他地址。" 同条里的 "Gemini API Key" 改为"模型服务 API Key"。
  - §1 "再由 Gemini 生成结构化文章" 改为"再由用户所选的模型生成结构化文章"。
  - §6 表格 M7 行：职责改为"模型（OpenAI 兼容接口）→ 结构化 JSON"。
  - §8 "不要重写已调好的 Gemini Prompt" 改为"不要重写已调好的提示词"。
  - §4.2、§5 等处其余 "Gemini" 字样按语义改为"模型"。
- [ ] **Step 2: 用户文档**
  - `README.md`：功能介绍与流程图改为中立说法并说明默认是 Gemini、可在设置里换成任何提供 OpenAI 兼容接口的服务；"配置 Gemini API Key"一节改写为"在设置里配置模型服务"，删除 `gemini-key.txt` 投放方式；"只接入了 Gemini"的限制说明改为"只支持 OpenAI 兼容接口；仅 Gemini 经过实测；模型必须能看图"；出站说明与 `SECURITY.md` 一致。
  - `SECURITY.md`：出站两类改为"YouTube，以及你在设置里配置的模型服务地址（字幕和画面会发往该地址）"；Key 一句改为"各模型服务的 API Key 按地址分别加密保存在系统钥匙串保护的文件里，只会发往它所属的地址"。
  - `CONTRIBUTING.md`：`.env` 说明与"不要引入新的出站请求"一条同步。
  - `THIRD_PARTY_NOTICES.md`：删除 `@google/genai` 一行；外部服务一节改为"模型服务：由用户自行配置，按该服务的条款与定价计费（默认 Google Gemini API）"。
  - `engine/.env.example`：列出 `STILLSCRIBE_AI_BASE_URL`、`STILLSCRIBE_AI_API_KEY`、`STILLSCRIBE_AI_MODEL`、`STILLSCRIBE_AI_IMAGE_SOURCE`，旧的两个 `STILLSCRIBE_GEMINI_*` 标注"已弃用，仍可用"。
- [ ] **Step 3: 架构类文档**：`docs/视频生成文章-AI集成.md` 顶部加一段说明"§1 的 geminiClient 与 §4 的 Key 方案已由 `docs/superpowers/specs/2026-11-18-model-provider-decoupling-design.md` 取代"，并把 §1、§2、§4 改写为现状；`docs/视频生成文章-架构文档.md` 里把 M7 与出站范围的表述同步。
- [ ] **Step 4: 代码里的残留**：删除 `shared/types.ts` 的 `GeminiModel` 别名并把 `ArticleMode`、事件流说明等注释里的 "Gemini" 改为"模型"；上面列出的几个文件的注释同理。
- [ ] **Step 5: 检查**
  - `pnpm test && pnpm typecheck` 通过。
  - `grep -rn -i "gemini" --include="*.ts" --include="*.vue" engine/src engine/scripts ui/src electron/src shared` 的输出只允许出现在：默认地址与默认模型的字面量、`AI_PRESETS` 的 Gemini 预设、旧环境变量名的兜底读取、旧 Key 文件名的迁移代码，以及它们的测试。
  - `git status` 确认 `engine/scripts/spike-openai-compat.ts` 已不存在。
- [ ] **Step 6: Commit** — `docs: 模型服务解耦——更新铁律 #6 出站范围与各处文档；清理 Gemini 命名残留`

---

### Task 12: 实机验证

对照规格第 7 节逐条验证。真实调用需要 `engine/.env` 里有可用的 Key。Electron 界面的检查方式见记忆 `verify-electron-ui-via-cdp`：`electron-vite dev --remoteDebuggingPort <端口>` 启动后，用 Node 的 `fetch` + `WebSocket` 连 `http://127.0.0.1:<端口>/json` 做 `Runtime.evaluate`；结束后手动清掉残留的引擎子进程。

- [ ] **Step 1: 真实调用冒烟** — `pnpm --filter @stillscribe/engine ai-smoke`，预期打印出一篇合法的 Article。
- [ ] **Step 2: 引擎路由**（`STILLSCRIBE_WORK_ROOT` 指向临时目录启动 `pnpm dev:engine`，令牌读 `<工作根>/engine-token`）
  - `GET /settings/ai` → `ready: true`、`keySource: "env"`，响应里没有 Key。
  - `POST /settings/ai/test` → `ok: true`、`seesImage: true`、`structuredMode: "json_schema"`。
  - 把模型名改成不存在的名字再测 → `ok: false`，`error` 指向配置问题；改回。
  - 不带令牌请求任一 `/settings/ai*` → 401。
- [ ] **Step 3: 桌面开发态**（同样用临时工作根）
  - 打开设置对话框：默认选中 Google Gemini 预设，地址只读。
  - 填入 Key → "保存并测试" → 结果行显示连接正常、能看图、支持强制结构。
  - 确认开发态 userData 下出现 `ai-keys.enc`，且其中搜不到 Key 明文；临时工作根的 `settings.db` 里也搜不到。
  - 切到"自定义"并填一个没有 Key 的 `https` 地址后保存 → 提交表单的 Auto 变为不可选；切回 Gemini 预设保存 → Auto 恢复可选，无需重填 Key。
  - 重启应用 → 配置与 Key 仍在。
- [ ] **Step 4: 失败原因可见**：把模型名改错后提交一个 `auto` 任务（用一条短视频）→ 任务进入待校对，校对页显示失败原因；改回正确模型再提交一个 → 生成文章草稿。
- [ ] **Step 5: 旧 Key 迁移**：退出应用，在开发态 userData 下删除 `ai-keys.enc`、放一个内容为可用 Key 的 `gemini-key.txt`，启动 → `gemini-key.txt` 被删除、`ai-keys.enc` 生成、Auto 可选。
- [ ] **Step 6: 纯 Web 模式**（`pnpm dev:engine` + `pnpm dev:ui`）：设置对话框里 Key 输入框禁用并显示提示，其余项可改可保存。
- [ ] **Step 7: 记录结果**：把每一步的实际结果（通过 / 未通过及原因）写进最终汇报；任何一步未通过都要回到对应任务修复后重验，不得略过。
