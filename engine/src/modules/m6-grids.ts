/**
 * M6 宫格图：把代表帧拼成 gridCols×gridRows 张/组（水印随帧自带，M3 已烧进 webp）。
 * 输入是 M5 代表帧的 02_webp/<name>.webp；输出 03_grids/grid_NNN.jpg。
 *
 * 拼图用 ffmpeg 的 tile 滤镜（原 ImageMagick montage 已去除，以脱离 ImageMagick 依赖）：
 *   把该组代表帧按序号软链到临时目录 → image2 序列读入 → scale + tile → 单帧 jpg。
 */
import { mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULTS } from "@shared/types";
import { toolPath } from "../cli/tools.ts";
import { runCmd } from "../cli/shell.ts";

const PER_GRID = DEFAULTS.gridCols * DEFAULTS.gridRows; // 10×5 = 50
const TILE = `${DEFAULTS.gridCols}x${DEFAULTS.gridRows}`;
const CELL_W = 320;
const CELL_H = 180; // 每格几何尺寸（与原 montage 一致）

/** 第 i 组（0-based）的输出文件名：grid_001.jpg … */
export function gridName(index: number): string {
  return `grid_${String(index + 1).padStart(3, "0")}.jpg`;
}

/** 把 frames 切成每组 PER_GRID 帧。 */
export function chunkFrames(frames: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < frames.length; i += PER_GRID) {
    chunks.push(frames.slice(i, i + PER_GRID));
  }
  return chunks;
}

/**
 * 构造 ffmpeg tile 命令（纯函数，便于断言）。
 * seqDir 内是按 %05d.webp 编号的有序软链（由 buildGrids 准备）。
 */
export function buildGridArgs(seqDir: string, outPath: string): string[] {
  return [
    toolPath("ffmpeg"), "-y",
    "-framerate", "1",
    "-i", path.join(seqDir, "%05d.webp"),
    "-vf", `scale=${CELL_W}:${CELL_H},tile=${TILE}:padding=2:color=black`,
    "-frames:v", "1",
    outPath,
  ];
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 拼宫格图（幂等：目标 grid_NNN.jpg 已存在则跳过该组）。返回输出路径列表。 */
export async function buildGrids(
  webpDir: string,
  gridsDir: string,
  frames: string[],
): Promise<string[]> {
  const outputs: string[] = [];
  const chunks = chunkFrames(frames);
  for (let i = 0; i < chunks.length; i++) {
    const out = path.join(gridsDir, gridName(i));
    outputs.push(out);
    if (await exists(out)) continue;

    // 把该组帧按 1-based 序号软链到临时目录，喂 ffmpeg image2 序列（保证顺序）。
    const seqDir = await mkdtemp(path.join(tmpdir(), "grid-"));
    try {
      const chunk = chunks[i]!;
      for (let j = 0; j < chunk.length; j++) {
        const seq = String(j + 1).padStart(5, "0");
        await symlink(path.join(webpDir, `${chunk[j]}.webp`), path.join(seqDir, `${seq}.webp`));
      }
      await runCmd(buildGridArgs(seqDir, out), { timeoutMs: 600_000 });
    } finally {
      await rm(seqDir, { recursive: true, force: true });
    }
  }
  return outputs;
}
