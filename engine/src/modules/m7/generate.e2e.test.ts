/**
 * M7 端到端（软件路径）：用 stub GeminiClient 跑通 备料 → client → 解析校验 → 落盘 article.json。
 * 不触网、不依赖真 SDK——验证除"Gemini HTTP"外的全部编排正确。真 SDK 调用见 scripts/gemini-smoke.ts。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Article } from "@shared/types";
import { TaskDir } from "../../paths.ts";
import { writeManifest } from "../m5-select.ts";
import { generateArticle } from "./index.ts";
import type { GeminiClient, GenerateArticleInput } from "./geminiClient.ts";

let root: string;
let td: TaskDir;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "m7-e2e-"));
  td = TaskDir.create(root, "vid123", "Test Video");
  // 三秒帧：01_hd 与 02_webp 各 3 张（内容无所谓，stub 不看像素）。
  for (const ts of ["00_00_00", "00_00_01", "00_00_02"]) {
    writeFileSync(path.join(td.hd, `${ts}.jpg`), "jpgbytes");
    writeFileSync(path.join(td.webp, `${ts}.webp`), "webpbytes");
  }
  // 代表帧清单（frames 策略读它）。
  writeManifest(td.representativesJson, ["00_00_00", "00_00_02"], 15);
  // 字幕。
  writeFileSync(
    path.join(td.source, "video.en.srt"),
    "1\n00:00:00,000 --> 00:00:02,000\nHello world\n",
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/** 记录收到的输入、回吐固定 Article 的 stub。 */
function stubClient(article: Article, captured: { input?: GenerateArticleInput }): GeminiClient {
  return {
    async generateArticle(input) {
      captured.input = input;
      return article;
    },
  };
}

const goodArticle: Article = {
  pages: [
    { subhead: "Intro", image: "00_00_00", body: "This is the intro. It hooks you." },
    { subhead: "1. Next", image: "00_00_02", body: "More content here. Read on." },
  ],
  meta: { titles: ["t1", "t2", "t3"], keywords: ["a", "b"], description: "A short desc." },
  notes: { frameworkRationale: "中文说明", imageRationale: "中文 CoT" },
};

describe("generateArticle 端到端（stub client）", () => {
  it("备料→生成→落盘 article.json，且喂入 prompt/字幕/图片", async () => {
    const captured: { input?: GenerateArticleInput } = {};
    const { article, warnings } = await generateArticle({
      taskDir: td,
      videoTitle: "Test Video",
      imageSource: "frames",
      client: stubClient(goodArticle, captured),
    });

    expect(article.pages).toHaveLength(2);
    expect(warnings).toEqual([]); // 两张配图都在帧集合内
    // 落盘
    expect(existsSync(td.articleJson)).toBe(true);
    const onDisk = JSON.parse(readFileSync(td.articleJson, "utf-8")) as Article;
    expect(onDisk.pages[0]!.image).toBe("00_00_00");
    // 喂入校验：2 张代表帧（frames 策略取 manifest）、字幕已清洗、prompt 含标题
    expect(captured.input!.images).toHaveLength(2);
    expect(captured.input!.images[0]!.mimeType).toBe("image/webp");
    expect(captured.input!.subtitles).toBe("Hello world");
    expect(captured.input!.prompt).toContain("Test Video");
  });

  it("配图时间戳不在帧集合内 → 记 warning（待人工换图），不抛错", async () => {
    const bad: Article = structuredClone(goodArticle);
    bad.pages[1]!.image = "09_09_09"; // 不存在的帧
    const { warnings } = await generateArticle({
      taskDir: td,
      videoTitle: "Test Video",
      imageSource: "frames",
      client: stubClient(bad, {}),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("09_09_09");
  });

  it("imageSource=grids 时读 03_grids 的 jpg", async () => {
    writeFileSync(path.join(td.grids, "grid_001.jpg"), "gridbytes");
    const captured: { input?: GenerateArticleInput } = {};
    await generateArticle({
      taskDir: td,
      videoTitle: "Test Video",
      imageSource: "grids",
      client: stubClient(goodArticle, captured),
    });
    expect(captured.input!.images).toHaveLength(1);
    expect(captured.input!.images[0]!.mimeType).toBe("image/jpeg");
  });
});
