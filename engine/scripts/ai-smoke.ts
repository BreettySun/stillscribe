/**
 * 真·模型服务连通性冒烟测试：对当前配置的地址跑一次 chat/completions，验证
 *   Key 通、结构化输出（json_schema 及降级）通、返回内容 → parseAndValidateArticle 通。
 *
 * 用法：在 engine/.env 配好 STILLSCRIBE_AI_API_KEY（可选 STILLSCRIBE_AI_BASE_URL / STILLSCRIBE_AI_MODEL）后，
 *   pnpm --filter @stillscribe/engine ai-smoke
 * 它只发一张 1×1 占位图 + 一句提示词，成本极低；不下载视频、不依赖任务目录。
 */
import { loadDotEnv } from "../src/env.ts";
import { AIConfig } from "../src/modules/m7/aiConfig.ts";
import { createArticleClient } from "../src/modules/m7/articleClient.ts";

// 1×1 透明 PNG。
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = new AIConfig(process.env).resolve();
  if (!cfg.ready) {
    console.error("❌ 缺少 STILLSCRIBE_AI_API_KEY —— 请在 engine/.env 配置（见 engine/.env.example）。");
    process.exit(1);
  }
  console.error(`→ 调用 ${cfg.baseUrl} 的模型 ${cfg.model} …`);
  const client = createArticleClient({
    baseUrl: cfg.baseUrl,
    ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
    model: cfg.model,
    onStructuredMode: (mode) => console.error(`  结构化输出级别: ${mode}`),
  });
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
