/**
 * 字幕清洗：SRT → 纯文本（喂模型用）。与半自动同源（AI 集成文档 §1：subtitles 为"已清洗字幕"）。
 *
 * 仅做轻量结构剥离：去序号行、去时间码行、合并连续重复行（自动字幕常逐词滚动重复）。
 * 不翻译、不改写、不整段引用版权文本之外的加工（CLAUDE.md §8 版权约束）。
 *
 * 无字幕（M2 srt 为 null）时上层传入空串即可，M7 仍可仅凭画面工作。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { matchFiles } from "../../paths.ts";

const TIMECODE_RE = /^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->/;
const INDEX_RE = /^\d+$/;
// SRT/VTT 内联标签与位置信息（如 <c>、align:start position:0%）。
const TAG_RE = /<[^>]+>/g;

/** 把 SRT 文本清成连贯纯文本。 */
export function cleanSrt(srt: string): string {
  const out: string[] = [];
  let prev = "";
  for (const raw of srt.split(/\r?\n/)) {
    const line = raw.replace(TAG_RE, "").trim();
    if (line === "" || INDEX_RE.test(line) || TIMECODE_RE.test(line) || line === "WEBVTT") continue;
    if (line === prev) continue; // 跳过紧邻重复（自动字幕滚动）
    out.push(line);
    prev = line;
  }
  return out.join("\n");
}

/**
 * 在 source/ 找字幕 srt（M7 只需字幕，不像 M2 findOutputs 那样强依赖 mp4）。
 * 优先纯 `.en.srt`（人工/原生英文轨），en-XX 自动翻译轨次之；无字幕返回 null。
 */
export async function findSubtitlePath(sourceDir: string): Promise<string | null> {
  const srts = (await matchFiles(sourceDir, "*.srt")).sort(
    (a, b) => (a.endsWith(".en.srt") ? 0 : 1) - (b.endsWith(".en.srt") ? 0 : 1),
  );
  return srts[0] ? path.join(sourceDir, srts[0]) : null;
}

/** 读取并清洗 srt 文件；路径为 null/读取失败 → 返回空串（字幕是次要输入，不阻断 M7）。 */
export async function loadCleanSubtitles(srtPath: string | null): Promise<string> {
  if (!srtPath) return "";
  try {
    return cleanSrt(await readFile(srtPath, "utf-8"));
  } catch {
    return "";
  }
}
