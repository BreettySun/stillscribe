# 视频生成图文文章工具 — 全自动 AI 接入方案（M7）

> 配套：《视频生成文章-架构文档》v0.5、《前端架构》、`CLAUDE.md`、`shared/types.ts`
> 前提：**半自动模式（备料 + 人工回填 JSON）已实现。** 本文档只讲在其之上接入**全自动（Gemini API）**。

---

## 0. 核心认知

全自动**不是另起一套**，而是把半自动里那条"人工把 JSON 粘回应用"的路径，换成"调 API 拿 JSON"。两者产出同一个 `Article` 结构，**下游全部复用**：校验、写 `article/article.json`、`awaiting_review`、人工校对、M8 生成 docx——都不动。

> 全自动 = 现有半自动 + 一个 `geminiClient` + `responseSchema` 强制 `Article` + Key 走 `safeStorage` + `mode=auto` 时 M7 改为直接调它。真正新增的代码很少。

---

## 1. 唯一新增组件：`geminiClient`

把"调 Gemini"包成一个函数：输入素材、输出 `Article`。放在引擎 `engine/src/modules/m7/`，外部只认接口，内部用官方 SDK 实现。

- SDK 用 **`@google/genai`**（`GoogleGenAI` 类）；旧的 `@google/generative-ai` 已 legacy，不用。它是纯 JS 包、不带原生二进制，**不涉及 electron-rebuild**，打包零负担。
- 外包一层自有接口：将来换裸 HTTP / 换模型 / 换供应商，只改这一个文件，M7 其余逻辑不动。

```ts
// engine/src/modules/m7/geminiClient.ts
import { GoogleGenAI } from "@google/genai";
import type { Article } from "../../../shared/types";

export interface ImagePart { base64: string; mimeType: string; } // image/webp | image/png

export interface GenerateArticleInput {
  images: ImagePart[];   // 代表帧或宫格图
  subtitles: string;     // 已清洗字幕（与半自动同源）
  prompt: string;        // 模板渲染后的提示词（与半自动同一套模板）
}

export interface GeminiClient {
  generateArticle(input: GenerateArticleInput): Promise<Article>;
}

export function createGeminiClient(opts: {
  apiKey: string;  // 引擎从 safeStorage 取，绝不来自渲染进程明文
  model: string;   // 可配置，如 "gemini-2.5-flash"
}): GeminiClient {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  return {
    async generateArticle(input) {
      const res = await ai.models.generateContent({
        model: opts.model,
        contents: [
          { text: input.prompt },
          { text: input.subtitles },
          ...input.images.map((im) => ({
            inlineData: { data: im.base64, mimeType: im.mimeType },
          })),
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: articleResponseSchema, // 见第 2 节
        },
      });
      return parseAndValidateArticle(res.text); // zod 校验，复用半自动那套
    },
  };
}
```

> SDK 的具体字段名以 `@google/genai` 当时版本文档为准；骨架表达的是结构与边界。

---

## 2. 用 responseSchema 强制结构（全自动的稳定性核心）

半自动靠人眼保证粘回的 JSON 合法；全自动没人把关，必须在 API 层强制：

- 配 `responseMimeType: "application/json"` + `responseSchema`，schema **镜像 `shared/types.ts` 的 `Article`**（pages[].{subhead,image,body} + meta + 可选 notes）。
- 返回后走**已有的 zod 校验**（半自动很可能已实现，直接复用）；失败重试，多次失败降级（见第 6 节）。
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

半自动不需要 Key，全自动需要。对应铁律"密钥只在本地、绝不进 git/localStorage/URL"，Google 官方亦强调 Key 只应在服务端用：

- 用户在「设置」填 Key → 用 Electron **`safeStorage`**（macOS 走钥匙串加密）存。
- **调用由引擎完成**，引擎读取 Key 发请求；**渲染进程只负责"填 Key"的 UI，拿不到明文**。
- 绝不硬编码、不进仓库、不写进 URL/query、不放 localStorage。

---

## 5. 成本与限流

- 按量付费：接进已有限流器（单批数量 / 间隔），避免批量任务一次打爆 API。
- 模型作为可配置项（速度 / 质量 / 价格权衡，见待确认项）。

---

## 6. 失败兜底：降级回已有的半自动 UI

API 会超时、限流、偶发吐坏 JSON。处理：重试几次仍失败 → **降级到现成的半自动校对界面让人工接手**。因半自动 UI 已在，全自动的失败兜底几乎零成本。

---

## 7. 全自动专属优化：可能不必拼宫格图

半自动拼宫格图是为绕网页版"单次传图数量限制"。**走 API 时限制不同，很可能可直接发去重后的单帧**——模型看单帧比看宫格里缩小的子图更清楚、配图更准，还能在 `auto` 模式下**跳过 M6 拼图**，使全自动链路反而更短。接 API 时实测确认。

---

## 8. 待确认项

- 模型选择（速度/质量/价格），是否需多档可选。
- 单次请求图片数量/体积上限 → 直接决定第 7 节"单帧 vs 宫格图"与分批策略。
- 结构化输出失败的降级 UX（直接进校对手修 vs 自动重试几次）。
