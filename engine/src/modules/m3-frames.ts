/**
 * M3 帧生成（含原 M3+M4）：每个全集一趟 ffmpeg，源视频直出成品帧。
 * CLAUDE.md 铁律 #2：抽帧/缩放/水印/转 webp 全由 ffmpeg 一趟完成，引擎内不引入图像库做二次编码。
 *
 * - 02_webp: fps=1 + scale=640:360 + drawtext 时间戳水印 + libwebp（M5/M6 用）
 * - 01_hd:   fps=1 + scale=1280:720 + jpg（换图浏览 + M8 配图源；docx 对 webp 支持不稳，HD 用 jpg）
 * - -frame_pts 1 使输出文件名 = pts 秒数，重命名为 HH_MM_SS 是纯算术映射
 */
import { glob, rename } from "node:fs/promises";
import path from "node:path";
import { toolPath } from "../cli/tools.ts";
import { runCmd } from "../cli/shell.ts";
import { secondsToName } from "../paths.ts";

// %{pts\:hms} 展开为 HH:MM:SS.mmm；fps=1 下毫秒恒为 000
const DRAWTEXT =
  "drawtext=text='%{pts\\:hms}'" +
  ":fontcolor=white:fontsize=28:x=12:y=12" +
  ":box=1:boxcolor=black@0.5:boxborderw=6";

export function buildWebpArgs(video: string, outDir: string): string[] {
  return [
    toolPath("ffmpeg"), "-y", "-i", video,
    "-vf", `fps=1,scale=640:360,${DRAWTEXT}`,
    "-c:v", "libwebp", "-q:v", "80",
    "-frame_pts", "1",
    // 机器可读进度写 stdout，供解析；不影响产物。
    "-progress", "pipe:1",
    path.join(outDir, "%d.webp"),
  ];
}

export function buildHdArgs(video: string, outDir: string): string[] {
  return [
    toolPath("ffmpeg"), "-y", "-i", video,
    "-vf", "fps=1,scale=1280:720",
    "-q:v", "2",
    "-frame_pts", "1",
    "-progress", "pipe:1",
    path.join(outDir, "%d.jpg"),
  ];
}

/**
 * 解析 ffmpeg `-progress` 输出里最近的 out_time（已处理秒数），返回秒；无匹配返回 null。
 * 形如 `out_time=00:01:23.000000`。
 */
export function parseFfmpegOutTimeSeconds(chunk: string): number | null {
  let last: number | null = null;
  const re = /out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) {
    const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (Number.isFinite(sec)) last = sec;
  }
  return last;
}

/** ffprobe 取视频时长（秒）；失败返回 null（不致命，仅退化为无细分进度）。 */
async function probeDurationSeconds(video: string): Promise<number | null> {
  try {
    const { stdout } = await runCmd([
      toolPath("ffprobe"), "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=nokey=1:noprint_wrappers=1",
      video,
    ], { timeoutMs: 30_000 });
    const d = Number(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

async function listFiles(dir: string, pattern: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of glob(pattern, { cwd: dir })) out.push(entry);
  return out;
}

/** 把 ffmpeg 产出的 `<秒数>.ext` 重命名为 `HH_MM_SS.ext`。返回重命名数量。 */
async function renameToHhmmss(outDir: string, suffix: string): Promise<number> {
  let count = 0;
  for (const name of await listFiles(outDir, `*${suffix}`)) {
    const stem = name.slice(0, -suffix.length);
    if (!/^\d+$/.test(stem)) continue;
    await rename(
      path.join(outDir, name),
      path.join(outDir, `${secondsToName(Number(stem))}${suffix}`),
    );
    count++;
  }
  return count;
}

/** HH_MM_SS 命名（已改名的成品帧）；中断时遗留的是 ffmpeg 原始数字名（如 `5`）。 */
const HHMMSS_RE = /^\d{2}_\d{2}_\d{2}$/;

/**
 * 一趟抽帧是否“干净完成”：非空且全部已改名为 HH_MM_SS。
 * 只要存在数字名残片（中断在 ffmpeg 写出后、renameToHhmmss 前被杀），即判未完成 → 需重跑。
 * 否则弱判断（仅看目录非空）会把残片当成品跳过，导致换图画廊时间戳错乱、代表帧全失配。
 */
export function isCompletePass(stems: string[]): boolean {
  return stems.length > 0 && stems.every((s) => HHMMSS_RE.test(s));
}

async function stemsOf(dir: string, suffix: string): Promise<string[]> {
  return (await listFiles(dir, `*${suffix}`)).map((f) => f.slice(0, -suffix.length));
}

/** 生成两个全集（幂等：两个全集都“干净完成”才整步跳过）。返回 webp 帧数。 */
export async function generateFrames(
  video: string,
  webpDir: string,
  hdDir: string,
  signal?: AbortSignal,
  onProgress?: (ratio: number) => void,
): Promise<number> {
  const webpDone = isCompletePass(await stemsOf(webpDir, ".webp"));
  const hdDone = isCompletePass(await stemsOf(hdDir, ".jpg"));
  if (webpDone && hdDone) return (await listFiles(webpDir, "*.webp")).length;

  const opt = signal ? { signal } : {};
  // 两趟 ffmpeg：webp 占进度前半 [0,0.5]，hd 占后半 [0.5,1]，各按 out_time/时长细分。
  const duration = onProgress ? await probeDurationSeconds(video) : null;
  const passProgress = (base: number, span: number) =>
    onProgress && duration
      ? {
          onStdout: (chunk: string) => {
            const sec = parseFfmpegOutTimeSeconds(chunk);
            if (sec != null) {
              onProgress(base + span * Math.min(Math.max(sec / duration, 0), 1));
            }
          },
        }
      : {};

  await runCmd(buildWebpArgs(video, webpDir), {
    timeoutMs: 7_200_000, ...opt, ...passProgress(0, 0.5),
  });
  await renameToHhmmss(webpDir, ".webp");
  await runCmd(buildHdArgs(video, hdDir), {
    timeoutMs: 7_200_000, ...opt, ...passProgress(0.5, 0.5),
  });
  await renameToHhmmss(hdDir, ".jpg");
  return (await listFiles(webpDir, "*.webp")).length;
}
