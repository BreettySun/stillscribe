/**
 * P1 命令行入口：tsx src/run.ts <youtube_url> [--quality 1080|1440] [--browser safari|chrome] [--work-root <dir>]
 *
 * 当前打通到 M8（M2 下载 → M3 出帧 → M5 去重 → M6 宫格图 → M8 docx）。
 * M7（文章生成）暂由 Claude 读宫格图+字幕生成 article.json 回填，故 M8 依赖其存在。
 * 每步幂等、产物落盘，可单步重跑（CLAUDE.md 铁律 #7）。
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULTS, type Article, type TaskParams, type VideoQuality } from "@shared/types";
import { resolveCookiesFile } from "./paths.ts";
import { runToGrids, runDocx } from "./orchestrator/pipeline.ts";

interface Cli {
  url: string;
  quality: VideoQuality;
  browser?: string;
  workRoot: string;
  threshold: number;
}

function parseArgs(argv: string[]): Cli {
  const positional: string[] = [];
  let quality: VideoQuality = 1080;
  let browser: string | undefined;
  let workRoot = path.resolve("work");
  let threshold: number = DEFAULTS.dedupThreshold;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--quality") quality = Number(argv[++i]) === 1440 ? 1440 : 1080;
    else if (a === "--browser") browser = argv[++i];
    else if (a === "--work-root") workRoot = path.resolve(argv[++i]!);
    else if (a === "--threshold") threshold = Number(argv[++i]);
    else positional.push(a);
  }

  const url = positional[0];
  if (!url) {
    throw new Error(
      "用法: tsx src/run.ts <youtube_url> [--quality 1080|1440] [--browser safari|chrome] [--threshold N] [--work-root <dir>]",
    );
  }
  return { url, quality, browser, workRoot, threshold };
}

async function runPipeline(cli: Cli): Promise<void> {
  const params: TaskParams = {
    url: cli.url,
    quality: cli.quality,
    dedup: true,
    dedupThreshold: cli.threshold,
    mode: "semi",
  };

  // 按任务即时探测 <workRoot>/cookies.txt（或 DIGGO_COOKIES_FILE 覆盖）；无效则回退 --cookies-from-browser。
  const cookiesFile = resolveCookiesFile(cli.workRoot);
  const { taskDir: td, videoId, videoTitle, frames, grids } = await runToGrids(params, {
    workRoot: cli.workRoot,
    browser: cli.browser,
    ...(cookiesFile ? { cookiesFile } : {}),
    onInfo: ({ workDir, videoTitle }) => console.error(`[M2] ${videoTitle}\n     工作目录: ${workDir}`),
    onStep: ({ step, message }) => console.error(`[${step}] ${message ?? ""}`),
  });
  console.error(`[done] ${videoId} — ${videoTitle}: ${frames} 帧, ${grids.length} 张宫格图 → ${td.root}`);

  // M7：暂由 Claude 读宫格图+字幕生成 article.json 回填（无 Gemini Key）。
  if (!existsSync(td.articleJson)) {
    console.error(
      `\n⏸  等待 article.json（M7 待建：把 ${td.grids} 的宫格图 + 字幕交给 Claude，` +
        `按共享 Article 契约生成 JSON 存为 ${td.articleJson}，再重跑续接 M8）。`,
    );
    return;
  }

  if (existsSync(td.docx)) {
    console.error(`[docx] 已存在，跳过（幂等）: ${td.docx}`);
    return;
  }
  const article = JSON.parse(await readFile(td.articleJson, "utf-8")) as Article;
  const { docxPath, warnings } = await runDocx(article, td, ({ message }) =>
    console.error(`[docx] ${message ?? ""}`),
  );
  for (const w of warnings) console.error(`     [warn] ${w}`);
  console.error(`\n✅ 当前阶段完成（至 M8）。docx 可手动「导入 Word」进飞书: ${docxPath}`);
}

async function main(): Promise<void> {
  await runPipeline(parseArgs(process.argv.slice(2)));
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
