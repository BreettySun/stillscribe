/**
 * M2 下载：yt-dlp 封装。
 * - 默认 1080p（`<=` 语义，无对应分辨率自动降级）
 * - 人工 + 自动英文字幕转 srt（仅真·英文轨，不抓自动翻译轨——见下）
 * - 支持 --cookies-from-browser
 * 幂等：source/ 已有 mp4 直接复用，不重复下载。
 *
 * 字幕作为次要产物**单独一趟、失败不致命**：视频先下成，再尽力取英文字幕。
 * 字幕语言用精确白名单而非 `en.*` 通配——通配会命中 YouTube 自动翻译轨（en-sl/en-fr… 上百条），
 * 逐条下载极易触发 HTTP 429。缺字幕时 M7 仍可工作（srt 允许为 null）。
 */
import { glob } from "node:fs/promises";
import path from "node:path";
import type { VideoQuality } from "@shared/types";
import { toolPath } from "../cli/tools.ts";
import { runCmd } from "../cli/shell.ts";

/** 取信息（不下载），用于建任务目录前拿到 id + title。 */
/**
 * cookies 选项：cookiesFile（Netscape cookies.txt，--cookies）优先于 browser（--cookies-from-browser）。
 * cookies.txt 是纯文件读取，不碰系统 Keychain/TCC，故在 Electron 子进程里也可靠
 * （--cookies-from-browser 在 Electron 下读 Chrome 钥匙串常失败 → 仍撞 bot 验证）。
 */
function pushCookieArgs(args: string[], browser?: string, cookiesFile?: string): void {
  if (cookiesFile) args.push("--cookies", cookiesFile);
  else if (browser) args.push("--cookies-from-browser", browser);
}

export function buildInfoArgs(url: string, browser?: string, cookiesFile?: string): string[] {
  const args = [
    toolPath("yt-dlp"),
    "--no-playlist",
    "--print", "%(id)s\t%(title)s",
    "--skip-download",
  ];
  pushCookieArgs(args, browser, cookiesFile);
  args.push(url);
  return args;
}

export interface VideoInfo {
  videoId: string;
  title: string;
}

export async function fetchVideoInfo(
  url: string,
  browser?: string,
  cookiesFile?: string,
  signal?: AbortSignal,
): Promise<VideoInfo> {
  const { stdout } = await runCmd(buildInfoArgs(url, browser, cookiesFile), {
    timeoutMs: 120_000,
    ...(signal ? { signal } : {}),
  });
  const line = stdout.trim();
  const tab = line.indexOf("\t");
  if (tab < 0) throw new Error(`yt-dlp 信息输出异常: ${JSON.stringify(line)}`);
  return { videoId: line.slice(0, tab), title: line.slice(tab + 1) };
}

const OUTPUT_TEMPLATE = "%(title).80s [%(id)s].%(ext)s";

/** 视频下载（不含字幕——字幕单独一趟，见 buildSubsArgs）。 */
export function buildDownloadArgs(
  url: string,
  sourceDir: string,
  quality: VideoQuality = 1080,
  browser?: string,
  cookiesFile?: string,
): string[] {
  const args = [
    toolPath("yt-dlp"),
    "--no-playlist",
    "-f", `bv*[height<=${quality}]+ba/b[height<=${quality}]`,
    "--merge-output-format", "mp4",
    "-o", path.join(sourceDir, OUTPUT_TEMPLATE),
  ];
  pushCookieArgs(args, browser, cookiesFile);
  args.push(url);
  return args;
}

/**
 * 仅取英文字幕（人工 + 自动），转 srt。
 * 语言用精确白名单（不含自动翻译轨 en-xx），并放慢请求节流以避开 429。
 */
export function buildSubsArgs(
  url: string,
  sourceDir: string,
  browser?: string,
  cookiesFile?: string,
): string[] {
  const args = [
    toolPath("yt-dlp"),
    "--no-playlist",
    "--skip-download",
    "--write-subs", "--write-auto-subs",
    "--sub-langs", "en,en-orig,en-US,en-GB",
    "--convert-subs", "srt",
    "--sleep-subtitles", "1",
    "--retries", "5",
    "-o", path.join(sourceDir, OUTPUT_TEMPLATE),
  ];
  pushCookieArgs(args, browser, cookiesFile);
  args.push(url);
  return args;
}

export interface DownloadOutputs {
  /** 下载得到的 mp4 绝对路径。 */
  mp4: string;
  /** 英文字幕 srt 绝对路径；无字幕时为 null。 */
  srt: string | null;
}

async function listFiles(dir: string, pattern: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of glob(pattern, { cwd: dir })) {
    out.push(path.join(dir, entry));
  }
  return out.sort();
}

/** 在 source/ 找下载产物。srt 优先纯 `.en.srt`（人工/原生轨），en-XX 自动翻译轨次之。 */
export async function findOutputs(sourceDir: string): Promise<DownloadOutputs> {
  const mp4s = await listFiles(sourceDir, "*.mp4");
  if (mp4s.length === 0) {
    throw new Error(
      `${sourceDir} 下没有 mp4。常见原因：网络问题 / 需要 cookie` +
        "（加 --browser safari 或 chrome）/ 完全磁盘访问权限未授予。",
    );
  }
  const srts = (await listFiles(sourceDir, "*.srt")).sort((a, b) => {
    const rank = (p: string) => (p.endsWith(".en.srt") ? 0 : 1);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return { mp4: mp4s[0]!, srt: srts[0] ?? null };
}

/** 下载（幂等）：先下视频（致命），再尽力取英文字幕（失败不致命）。 */
export async function download(
  url: string,
  sourceDir: string,
  quality: VideoQuality = 1080,
  browser?: string,
  cookiesFile?: string,
  signal?: AbortSignal,
): Promise<DownloadOutputs> {
  const existing = await listFiles(sourceDir, "*.mp4");
  if (existing.length === 0) {
    await runCmd(buildDownloadArgs(url, sourceDir, quality, browser, cookiesFile), {
      timeoutMs: 3_600_000,
      ...(signal ? { signal } : {}),
    });
  }
  // 字幕仅次要：429/无字幕等失败只记日志，不阻断流水线（srt 允许为 null）。
  if ((await listFiles(sourceDir, "*.srt")).length === 0) {
    try {
      await runCmd(buildSubsArgs(url, sourceDir, browser, cookiesFile), {
        timeoutMs: 300_000,
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      process.stderr.write(
        `[m2] 字幕获取失败（不影响视频/继续流水线）：${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
  return findOutputs(sourceDir);
}
