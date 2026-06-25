import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Article } from "@shared/types";
import { bodyToParagraphTexts, buildDocxBlocks, buildDocx } from "./m8-docx.ts";

describe("bodyToParagraphTexts", () => {
  it("按空行切段、去空白段", () => {
    expect(bodyToParagraphTexts("a\n\nb")).toEqual(["a", "b"]);
    expect(bodyToParagraphTexts("only one")).toEqual(["only one"]);
    expect(bodyToParagraphTexts("a\n\n\n\n  \n\nb")).toEqual(["a", "b"]);
    expect(bodyToParagraphTexts("   ")).toEqual([]);
  });
});

describe("buildDocxBlocks", () => {
  const article: Article = {
    pages: [
      { subhead: "Intro", image: "00_00_00", body: "引言一\n\n引言二" },
      { subhead: "1. LeBron", image: "00_00_01", body: "正文一" },
      { subhead: "2. Jordan", image: "00_00_02", body: "正文二" },
    ],
    meta: { titles: ["T1", "T2", "T3"], keywords: ["k1", "k2"], description: "desc" },
    notes: { frameworkRationale: "不应进 docx 的中文说明" },
  };

  it("顶部元信息块：Source/Title/Keywords/Description/Cover/Content 标签与值", () => {
    const blocks = buildDocxBlocks(article, "https://youtu.be/abc");
    const texts = blocks.map((b) => (b.kind === "para" ? b.text : `[img:${b.image}]`));
    expect(texts).toEqual([
      "Source:",
      "https://youtu.be/abc",
      "Title:",
      "T1",
      "T2",
      "T3",
      "Keywords:",
      "k1, k2",
      "Description:",
      "desc",
      "Cover: 420*315, jpg",
      "Content:",
      "[img:00_00_00]",
      "引言一",
      "引言二",
      // 编号小节：加粗小标题 + 配图 + 正文
      "1. LeBron",
      "[img:00_00_01]",
      "正文一",
      "2. Jordan",
      "[img:00_00_02]",
      "正文二",
    ]);
  });

  it("保留全部候选标题、每个独占一行（紧跟 Title: 之后）", () => {
    const blocks = buildDocxBlocks(article, "u");
    const i = blocks.findIndex((b) => b.kind === "para" && b.text === "Title:");
    expect(blocks.slice(i + 1, i + 4)).toEqual([
      { kind: "para", text: "T1" },
      { kind: "para", text: "T2" },
      { kind: "para", text: "T3" },
    ]);
  });

  it("引言（pages[0]）配图嵌在 Content 文字上方、无编号标题", () => {
    const blocks = buildDocxBlocks(article, "u");
    // 引言帧 00_00_00 仍渲染，且排在编号小节配图之前。
    const images = blocks.filter((b) => b.kind === "image").map((b) => (b as { image: string }).image);
    expect(images).toEqual(["00_00_00", "00_00_01", "00_00_02"]);
    // 引言图紧跟 Content: 标签、在引言正文之前。
    const ci = blocks.findIndex((b) => b.kind === "para" && b.text === "Content:");
    expect(blocks[ci + 1]).toEqual({ kind: "image", image: "00_00_00" });
    expect(blocks[ci + 2]).toEqual({ kind: "para", text: "引言一" });
    // 引言不作为编号标题出现。
    expect(blocks.some((b) => b.kind === "para" && b.text === "Intro")).toBe(false);
  });

  it("不再有文末 Meta 块；标签为加粗、值非加粗", () => {
    const blocks = buildDocxBlocks(article, "u");
    expect(blocks.some((b) => b.kind === "para" && b.text === "Meta")).toBe(false);
    const source = blocks.find((b) => b.kind === "para" && b.text === "Source:");
    expect(source).toEqual({ kind: "para", text: "Source:", bold: true });
  });

  it("不传 sourceUrl 时 Source 值为空串", () => {
    const blocks = buildDocxBlocks(article);
    const i = blocks.findIndex((b) => b.kind === "para" && b.text === "Source:");
    expect(blocks[i + 1]).toEqual({ kind: "para", text: "" });
  });
});

describe("buildDocx", () => {
  it("生成非空 docx buffer；缺图记 warning 不中断", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "docx-"));
    const hd = path.join(dir, "01_hd");
    await mkdir(hd, { recursive: true });
    // 造一张真实 1280×720 jpg（仅 00_00_01 存在；00_00_99 故意缺）
    await sharp({ create: { width: 1280, height: 720, channels: 3, background: { r: 10, g: 120, b: 200 } } })
      .jpeg().toFile(path.join(hd, "00_00_01.jpg"));

    const article: Article = {
      pages: [
        { subhead: "有图页", image: "00_00_01", body: "段一\n\n段二" },
        { subhead: "缺图页", image: "00_00_99", body: "正文" },
      ],
      meta: { titles: ["T1", "T2"], keywords: ["k1", "k2"], description: "desc" },
      notes: { frameworkRationale: "不应进 docx 的中文说明" },
    };

    const { buffer, warnings } = await buildDocx(article, hd);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("00_00_99");
    expect(buffer.length).toBeGreaterThan(0);
  });
});
