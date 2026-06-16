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
import { DEFAULTS, type Article, type VideoQuality } from "@shared/types";
import { TaskDir } from "./paths.ts";
import { fetchVideoInfo, download } from "./modules/m2-download.ts";
import { generateFrames } from "./modules/m3-frames.ts";
import { selectRepresentatives, writeManifest } from "./modules/m5-select.ts";
import { buildGrids } from "./modules/m6-grids.ts";
import { buildDocx } from "./modules/m8-docx.ts";

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
  console.error(`[M2] 取视频信息: ${cli.url}`);
  const { videoId, title } = await fetchVideoInfo(cli.url, cli.browser);
  const td = TaskDir.create(cli.workRoot, videoId, title);
  console.error(`[M2] ${videoId} — ${title}\n     工作目录: ${td.root}`);

  console.error(`[M2] 下载 (<=${cli.quality}p)…`);
  const { mp4, srt } = await download(cli.url, td.source, cli.quality, cli.browser);
  console.error(`[M2] mp4: ${mp4}\n     srt: ${srt ?? "(无字幕)"}`);

  console.error(`[M3] 抽帧 (fps=1 → webp 640x360+水印 / hd 1280x720 jpg)…`);
  const frames = await generateFrames(mp4, td.webp, td.hd);
  console.error(`[M3] 完成: ${frames} 帧 → ${td.webp} / ${td.hd}`);

  console.error(`[M5] 去重选代表帧 (phash, threshold=${cli.threshold})…`);
  const kept = await selectRepresentatives(td.webp, cli.threshold);
  await writeManifest(td.representativesJson, kept, cli.threshold);
  console.error(`[M5] 代表帧 ${kept.length} / 全集 ${frames} → ${td.representativesJson}`);

  console.error(`[M6] 拼宫格图 (${DEFAULTS.gridCols}x${DEFAULTS.gridRows}/组)…`);
  const grids = await buildGrids(td.webp, td.grids, kept);
  console.error(`[M6] 完成: ${grids.length} 张宫格图 → ${td.grids}`);

  // M7：暂由 Claude 读宫格图+字幕生成 article.json 回填（无 Gemini Key）。
  if (!existsSync(td.articleJson)) {
    console.error(
      `\n⏸  等待 article.json（M7 待建：把 ${td.grids} 的宫格图 + 字幕交给 Claude，` +
        `按共享 Article 契约生成 JSON 存为 ${td.articleJson}，再重跑续接 M8）。`,
    );
    return;
  }

  if (existsSync(td.docx)) {
    console.error(`[M8] docx 已存在，跳过（幂等）: ${td.docx}`);
    return;
  }
  console.error(`[M8] 程序化生成 docx…`);
  const article = JSON.parse(await readFile(td.articleJson, "utf-8")) as Article;
  const warnings = await buildDocx(article, td.hd, td.docx);
  for (const w of warnings) console.error(`     [warn] ${w}`);
  console.error(`[M8] 完成: ${td.docx}`);
  console.error(`\n✅ 当前阶段完成（至 M8）。docx 可手动「导入 Word」进飞书。任务目录: ${td.root}`);
}

async function main(): Promise<void> {
  await runPipeline(parseArgs(process.argv.slice(2)));
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
