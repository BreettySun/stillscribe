# 视频生成图文文章工具 — 全自动 AI 接入方案（M7）

> 配套：《视频生成文章-架构文档》v0.5、《前端架构》、`CLAUDE.md`、`shared/types.ts`
> 前提：**半自动模式（备料 + 人工回填 JSON）已实现。** 本文档只讲在其之上接入**全自动（调用模型服务 API）**。
>
> **2026-11 更新**：原 §1 的 `geminiClient` 与 §4 的 Key 方案已由 `docs/superpowers/specs/2026-11-18-model-provider-decoupling-design.md` 取代。引擎现在经 Node `fetch` 调用任意 OpenAI 兼容的 `chat/completions` 服务（默认 Google Gemini 的兼容端点），不再依赖厂商 SDK；§1、§2、§4 已改写为现状，其余章节保留设计时的思路。

---

## 0. 核心认知

全自动**不是另起一套**，而是把半自动里那条"人工把 JSON 粘回应用"的路径，换成"调 API 拿 JSON"。两者产出同一个 `Article` 结构，**下游全部复用**：校验、写 `article/article.json`、`awaiting_review`、人工校对、M8 生成 docx——都不动。

> 全自动 = 现有半自动 + 一个 `articleClient` + 结构化输出强制 `Article` + Key 走 `safeStorage` + `mode=auto` 时 M7 改为直接调它。真正新增的代码很少。

---

## 1. 唯一新增组件：`articleClient`

把"调模型"包成一个函数：输入素材、输出 `Article`。放在引擎 `engine/src/modules/m7/`，外部只认接口，内部经通用的 `chat/completions` 客户端（`chat.ts`）实现。

- **不用任何厂商 SDK**，只用 Node 内置 `fetch` 调用 OpenAI 兼容接口。默认接口地址为 Google Gemini 的兼容端点 `https://generativelanguage.googleapis.com/v1beta/openai`，默认模型 `gemini-2.5-flash`；用户可在设置里换成其他提供 OpenAI 兼容接口的服务。**目前只有 Gemini 经过实测**，所选模型必须能看图。
- 接口地址必须是 `https`；`http` 只允许回环地址（本机模型），此时也可以不填 Key。
- 外包一层自有接口：换模型 / 换供应商只改配置，M7 其余逻辑不动。

```ts
// engine/src/modules/m7/articleClient.ts
export interface GenerateArticleInput {
  images: ImagePart[];   // 代表帧或宫格图（base64 + mimeType）
  subtitles: string;     // 已清洗字幕（与半自动同源）
  prompt: string;        // 模板渲染后的提示词（与半自动同一套模板）
}

export interface ArticleClient {
  generateArticle(input: GenerateArticleInput): Promise<Article>;
}

export function createArticleClient(opts: ArticleClientOptions): ArticleClient;
// ArticleClientOptions 扩展自 ChatOptions：baseUrl / apiKey / model 等，
// 由 AIConfig（engine/src/modules/m7/aiConfig.ts）解析得到
```

配置来源的优先级：设置里保存的值（非密钥项存引擎 SQLite 的 settings）> 环境变量 > 默认值。开发期环境变量为 `STILLSCRIBE_AI_BASE_URL`、`STILLSCRIBE_AI_API_KEY`、`STILLSCRIBE_AI_MODEL`、`STILLSCRIBE_AI_IMAGE_SOURCE`；旧的 `STILLSCRIBE_GEMINI_API_KEY`、`STILLSCRIBE_GEMINI_MODEL` 已弃用但仍可读。

---

## 2. 结构化输出（全自动的稳定性核心）

半自动靠人眼保证粘回的 JSON 合法；全自动没人把关，必须在接口层尽量强制：

- 客户端按三级降级请求结构化输出：先 `json_schema`（schema **镜像 `shared/types.ts` 的 `Article`**：pages[].{subhead,image,body} + meta + 可选 notes），服务端拒绝则降到 `json_object`，再不行就只靠提示词约束。每个（接口地址, 模型）组合上实际可用的级别会被记住，下次直接从该级别起步。
- 设置里的"测试连接"会报告：接口是否可达、模型是否看得见图、结构化输出用了哪一级。
- 返回后走**已有的 zod 校验**（`parse.ts`，与半自动共用）；失败重试，多次失败降级（见第 6 节）。
- 校验每个 `image` 时间戳确实在该任务帧集合内，不在则标记待人工换图。
- 中文说明/CoT 在 schema 层就与 `body` 分到 `notes`，从源头杜绝混入正文。

---

## 3. 流程：去掉"等待粘贴"那一停

按提交表单的 `mode` 分支：`auto` 走 client，`semi` 走原有备料路径。全自动跳过 `awaiting_paste`：

```
running(M7 自动调 API) → awaiting_review(写入 article.json) → 人工校对 → docx
```

注意：**全自动 ≠ 无人**。它仍进 `awaiting_review` 让你换图/校对，只是省掉"复制粘贴喂模型"那段体力活。

---

## 4. API Key 安全（全自动新引入）

半自动不需要 Key，全自动需要。对应铁律"密钥只在本地、绝不进 git/localStorage/URL"：

- 用户在应用「设置」的"模型服务"对话框填 Key；Electron 主进程用 **`safeStorage`**（macOS 走钥匙串加密）把它**按接口地址分别**加密保存到 userData 下的 `ai-keys.enc`（实现见 `electron/src/main/aiKeys.ts`）。旧版的 `gemini-key.enc` / `gemini-key.txt` 在启动时自动迁入并删除。
- **Key 与其接口地址绑定**：只会发往它保存时对应的地址，绝不发往其他地址；Key 只经 `Authorization: Bearer` 请求头发送。
- **调用由引擎完成**：主进程 spawn 引擎时把 Key 经环境变量注入；**渲染进程只负责"填 Key"的 UI，拿不到明文**。纯 Web 开发模式下 Key 只能来自 `engine/.env`。
- 绝不硬编码、不进仓库、不写进 URL/query、不放 localStorage，也不进 SQLite、日志和 HTTP 响应。

---

## 5. 成本与限流

- 按量付费：接进已有限流器（单批数量 / 间隔），避免批量任务一次打爆 API。
- 模型作为可配置项（速度 / 质量 / 价格权衡，见待确认项）。

---

## 6. 失败兜底：降级回已有的半自动 UI

API 会超时、限流、偶发吐坏 JSON，或者用户还没配置模型服务。处理：重试几次仍失败（或无法发起） → 任务**不标记失败**，而是转入人工校对，并在校对页显示原因，由人工接手。因半自动 UI 已在，全自动的失败兜底几乎零成本。

---

## 7. 全自动专属优化：可能不必拼宫格图

半自动拼宫格图是为绕网页版"单次传图数量限制"。**走 API 时限制不同，很可能可直接发去重后的单帧**——模型看单帧比看宫格里缩小的子图更清楚、配图更准，还能在 `auto` 模式下**跳过 M6 拼图**，使全自动链路反而更短。接 API 时实测确认。

> 现状：设置里提供喂图方式选项——宫格图（默认，省 token）或单帧（更清楚，成本高得多）。

---

## 8. 待确认项

- 模型选择（速度/质量/价格），是否需多档可选。
- 单次请求图片数量/体积上限 → 直接决定第 7 节"单帧 vs 宫格图"与分批策略。
- 结构化输出失败的降级 UX（直接进校对手修 vs 自动重试几次）。
