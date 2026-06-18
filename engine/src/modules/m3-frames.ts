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
    path.join(outDir, "%d.webp"),
  ];
}

export function buildHdArgs(video: string, outDir: string): string[] {
  return [
    toolPath("ffmpeg"), "-y", "-i", video,
    "-vf", "fps=1,scale=1280:720",
    "-q:v", "2",
    "-frame_pts", "1",
    path.join(outDir, "%d.jpg"),
  ];
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

/** 生成两个全集（幂等：两个目录都已有产物则整步跳过）。返回 webp 帧数。 */
export async function generateFrames(
  video: string,
  webpDir: string,
  hdDir: string,
  signal?: AbortSignal,
): Promise<number> {
  const haveWebp = (await listFiles(webpDir, "*.webp")).length > 0;
  const haveHd = (await listFiles(hdDir, "*.jpg")).length > 0;
  if (haveWebp && haveHd) return (await listFiles(webpDir, "*.webp")).length;

  const opt = signal ? { signal } : {};
  await runCmd(buildWebpArgs(video, webpDir), { timeoutMs: 7_200_000, ...opt });
  await renameToHhmmss(webpDir, ".webp");
  await runCmd(buildHdArgs(video, hdDir), { timeoutMs: 7_200_000, ...opt });
  await renameToHhmmss(hdDir, ".jpg");
  return (await listFiles(webpDir, "*.webp")).length;
}
