/**
 * M5 去重选帧：在 02_webp 全集上用 phash 选代表帧清单（仅服务于喂模型）。
 * 铁律 #5：逐秒全集不动，只产代表帧清单；默认开启。
 *
 * 贪心顺序保留：与上一张【已保留】的代表帧汉明距离 >= threshold 才保留。
 * threshold=0 ⇒ 任何距离都 >=0 ⇒ 保留全部；阈值越大保留越少。
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { phash, hamming } from "./m5-phash.ts";
import { matchFiles } from "../paths.ts";

/** 代表帧清单文件结构（内部产物，非前后端契约）。 */
export interface RepresentativesManifest {
  threshold: number;
  /** HH_MM_SS 名（无扩展、按时间序）。 */
  frames: string[];
}

async function listStems(webpDir: string): Promise<string[]> {
  const webps = await matchFiles(webpDir, "*.webp");
  return webps.map((e) => e.slice(0, -".webp".length)).sort();
}

/** 返回保留帧名列表（HH_MM_SS，按时间序）。 */
export async function selectRepresentatives(
  webpDir: string,
  threshold = 15,
): Promise<string[]> {
  const names = await listStems(webpDir);
  const kept: string[] = [];
  let lastHash: bigint | null = null;
  for (const name of names) {
    const h = await phash(path.join(webpDir, `${name}.webp`));
    if (lastHash === null || hamming(h, lastHash) >= threshold) {
      kept.push(name);
      lastHash = h;
    }
  }
  return kept;
}

export async function writeManifest(
  manifestPath: string,
  frames: string[],
  threshold: number,
): Promise<void> {
  const data: RepresentativesManifest = { threshold, frames };
  await writeFile(manifestPath, JSON.stringify(data, null, 2), "utf-8");
}

export async function loadManifest(manifestPath: string): Promise<string[]> {
  const data = JSON.parse(await readFile(manifestPath, "utf-8")) as RepresentativesManifest;
  return data.frames;
}
