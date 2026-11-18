/**
 * P1 命令行入口：tsx src/run.ts <youtube_url> [--quality 1080|1440] [--browser safari|chrome] [--work-root <dir>]
 *
 * 打通 M2 下载 → M3 出帧 → M5 去重 → M6 宫格图 → M7 文章 → M8 导出（docx / Markdown / HTML）。
 * M7：--mode auto 调模型生成 article.json；默认 semi 由人工回填 article.json 后重跑续接 M8。
 * 每步幂等、产物落盘，可单步重跑（CLAUDE.md 铁律 #7）。
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULTS, type Article, type ArticleMode, type TaskParams, type VideoQuality } from "@shared/types";
import { loadDotEnv } from "./env.ts";
import { resolveCookiesFile } from "./paths.ts";
import { runToGrids, runExport, runArticle } from "./orchestrator/pipeline.ts";
import { createArticleClient } from "./modules/m7/articleClient.ts";
import { resolveAIConfig } from "./modules/m7/config.ts";

interface Cli {
  url: string;
  quality: VideoQuality;
  browser?: string;
  workRoot: string;
  threshold: number;
  mode: ArticleMode;
}

function parseArgs(argv: string[]): Cli {
  const positional: string[] = [];
  let quality: VideoQuality = 1080;
  let browser: string | undefined;
  let workRoot = path.resolve("work");
  let threshold: number = DEFAULTS.dedupThreshold;
  let mode: ArticleMode = "semi";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--quality") quality = Number(argv[++i]) === 1440 ? 1440 : 1080;
    else if (a === "--browser") browser = argv[++i];
    else if (a === "--work-root") workRoot = path.resolve(argv[++i]!);
    else if (a === "--threshold") threshold = Number(argv[++i]);
    else if (a === "--mode") mode = argv[++i] === "auto" ? "auto" : "semi";
    else positional.push(a);
  }

  const url = positional[0];
  if (!url) {
    throw new Error(
      "用法: tsx src/run.ts <youtube_url> [--quality 1080|1440] [--browser safari|chrome] [--threshold N] [--mode auto|semi] [--work-root <dir>]",
    );
  }
  return { url, quality, browser, workRoot, threshold, mode };
}

async function runPipeline(cli: Cli): Promise<void> {
  const params: TaskParams = {
    url: cli.url,
    quality: cli.quality,
    dedup: true,
    dedupThreshold: cli.threshold,
    mode: cli.mode,
  };

  // 按任务即时探测 <workRoot>/cookies.txt（或 STILLSCRIBE_COOKIES_FILE 覆盖）；无效则回退 --cookies-from-browser。
  const cookiesFile = resolveCookiesFile(cli.workRoot);
  const { taskDir: td, videoId, videoTitle, frames, grids } = await runToGrids(params, {
    workRoot: cli.workRoot,
    browser: cli.browser,
    ...(cookiesFile ? { cookiesFile } : {}),
    onInfo: ({ workDir, videoTitle }) => console.error(`[M2] ${videoTitle}\n     工作目录: ${workDir}`),
    onStep: ({ step, message }) => console.error(`[${step}] ${message ?? ""}`),
  });
  console.error(`[done] ${videoId} — ${videoTitle}: ${frames} 帧, ${grids.length} 张宫格图 → ${td.root}`);

  // M7 全自动(auto)：直接调模型生成 article.json（配置由 resolveAIConfig 从 engine/.env 读 Key + 代码默认模型）。
  if (cli.mode === "auto" && !existsSync(td.articleJson)) {
    const cfg = resolveAIConfig();
    if (!cfg.apiKey) {
      console.error("\n⏸  --mode auto 需在 engine/.env 配置 STILLSCRIBE_GEMINI_API_KEY；未设置，降级为半自动（见下）。");
    } else {
      const client = createArticleClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model });
      const { warnings: w } = await runArticle(
        td,
        { client, videoTitle, imageSource: cfg.imageSource, modelLabel: cfg.model },
        ({ message }) => console.error(`[article] ${message ?? ""}`),
      );
      for (const m of w) console.error(`     [warn] ${m}`);
      console.error(`[article] 已生成 ${td.articleJson}`);
    }
  }

  // M7 半自动(semi)/auto 降级：由人读宫格图+字幕生成 article.json 回填。
  if (!existsSync(td.articleJson)) {
    console.error(
      `\n⏸  等待 article.json（把 ${td.grids} 的宫格图 + 字幕交给模型，` +
        `按共享 Article 契约生成 JSON 存为 ${td.articleJson}，再重跑续接 M8）。`,
    );
    return;
  }

  if ([td.docx, td.markdown, td.html].every((f) => existsSync(f))) {
    console.error(`[export] 导出文件已存在，跳过（幂等）: ${td.articleDir}`);
    return;
  }
  const article = JSON.parse(await readFile(td.articleJson, "utf-8")) as Article;
  const { outputs, warnings } = await runExport(
    article,
    td,
    { sourceUrl: cli.url, fallbackTitle: videoTitle },
    ({ message }) => console.error(`[export] ${message ?? ""}`),
  );
  for (const w of warnings) console.error(`     [warn] ${w}`);
  console.error("\n✅ 导出完成：");
  for (const [format, file] of Object.entries(outputs)) console.error(`     ${format}: ${file}`);
}

async function main(): Promise<void> {
  loadDotEnv(); // 加载 engine/.env（模型 Key/地址/模型名），供 --mode auto 使用。
  await runPipeline(parseArgs(process.argv.slice(2)));
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
