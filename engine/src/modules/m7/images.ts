/**
 * M7 全自动：收集喂给模型的图片，编码成 inlineData(base64)。
 *
 * 两种来源（AI 集成文档 §7）：
 * - "frames"：去重后的代表单帧（02_webp/<ts>.webp，含水印）；模型看单帧更清楚、配图更准，但成本高得多。
 * - "grids" ：宫格图（03_grids/*.jpg），默认；省 token，也是半自动绕网页版传图数量限制的老策略。
 *
 * 【铁律 #2】这里只读盘 + base64，不做任何图像二次解码/编码。
 * 注意单次请求图片数量/体积上限（AI 集成文档 §8 待确认）——上层可据此分批，本函数只负责取料。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AIImageSource } from "@shared/types";
import { TaskDir, matchFiles } from "../../paths.ts";
import { loadManifest } from "../m5-select.ts";

export interface ImagePart {
  base64: string;
  /** image/webp（代表帧）| image/jpeg（宫格图）。 */
  mimeType: string;
}

async function toPart(file: string, mimeType: string): Promise<ImagePart> {
  const buf = await readFile(file);
  return { base64: buf.toString("base64"), mimeType };
}

/** 按策略收集本任务的图片 parts。frames 缺 manifest 时抛错（应先跑 M5）。 */
export async function collectImages(td: TaskDir, source: AIImageSource): Promise<ImagePart[]> {
  if (source === "grids") {
    const files = await matchFiles(td.grids, "*.jpg");
    return Promise.all(files.map((f) => toPart(path.join(td.grids, f), "image/jpeg")));
  }
  // frames：代表帧清单 → 02_webp/<ts>.webp
  const stems = await loadManifest(td.representativesJson);
  return Promise.all(stems.map((ts) => toPart(path.join(td.webp, `${ts}.webp`), "image/webp")));
}
