/**
 * M2 下载：yt-dlp 封装。
 * - 默认 1080p（`<=` 语义，无对应分辨率自动降级）
 * - 人工 + 自动英文字幕转 srt（--sub-langs "en.*,en"）
 * - 支持 --cookies-from-browser
 * 幂等：source/ 已有 mp4 直接复用，不重复下载。
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
): Promise<VideoInfo> {
  const { stdout } = await runCmd(buildInfoArgs(url, browser, cookiesFile), { timeoutMs: 120_000 });
  const line = stdout.trim();
  const tab = line.indexOf("\t");
  if (tab < 0) throw new Error(`yt-dlp 信息输出异常: ${JSON.stringify(line)}`);
  return { videoId: line.slice(0, tab), title: line.slice(tab + 1) };
}

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
    "--write-subs", "--write-auto-subs",
    "--sub-langs", "en.*,en",
    "--convert-subs", "srt",
    "-o", path.join(sourceDir, "%(title).80s [%(id)s].%(ext)s"),
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

/** 下载（幂等）。 */
export async function download(
  url: string,
  sourceDir: string,
  quality: VideoQuality = 1080,
  browser?: string,
  cookiesFile?: string,
): Promise<DownloadOutputs> {
  const existing = await listFiles(sourceDir, "*.mp4");
  if (existing.length > 0) return findOutputs(sourceDir);
  await runCmd(buildDownloadArgs(url, sourceDir, quality, browser, cookiesFile), {
    timeoutMs: 3_600_000,
  });
  return findOutputs(sourceDir);
}
