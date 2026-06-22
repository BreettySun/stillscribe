/**
 * 真·Gemini 连通性冒烟测试：用真实 SDK 跑一次 generateContent，验证
 *   API Key 通、responseSchema(大写 Type) 通、res.text → parseAndValidateArticle 通。
 *
 * 用法：在 engine/.env 配好 DIGGO_GEMINI_API_KEY 后，
 *   pnpm --filter @diggo/engine gemini-smoke
 * 它只发一张 1×1 占位图 + 一句提示词，成本极低；不下载视频、不依赖任务目录。
 */
import { loadDotEnv } from "../src/env.ts";
import { resolveAIConfig } from "../src/modules/m7/config.ts";
import { createGeminiClient } from "../src/modules/m7/geminiClient.ts";

// 1×1 透明 PNG。
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = resolveAIConfig();
  if (!cfg.apiKey) {
    console.error("❌ 缺少 DIGGO_GEMINI_API_KEY —— 请在 engine/.env 配置（见 engine/.env.example）。");
    process.exit(1);
  }
  console.error(`→ 调用模型 ${cfg.model} …`);
  const client = createGeminiClient({ apiKey: cfg.apiKey, model: cfg.model });
  const article = await client.generateArticle({
    prompt:
      "This is a connectivity smoke test. Produce a minimal valid article: exactly one page " +
      'with subhead "Intro", image "00_00_00", and a 2-sentence English body about the provided ' +
      "image. Fill meta.titles (3), meta.keywords (a few), meta.description. Output strictly per the JSON schema.",
    subtitles: "",
    images: [{ base64: PNG_1x1, mimeType: "image/png" }],
  });
  console.error("✅ 成功，解析+校验通过。返回 Article：");
  console.log(JSON.stringify(article, null, 2));
}

main().catch((err: unknown) => {
  console.error(`\n❌ 失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
