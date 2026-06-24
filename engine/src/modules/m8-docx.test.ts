import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Article } from "@shared/types";
import { bodyToParagraphTexts, buildDocx } from "./m8-docx.ts";

describe("bodyToParagraphTexts", () => {
  it("按空行切段、去空白段", () => {
    expect(bodyToParagraphTexts("a\n\nb")).toEqual(["a", "b"]);
    expect(bodyToParagraphTexts("only one")).toEqual(["only one"]);
    expect(bodyToParagraphTexts("a\n\n\n\n  \n\nb")).toEqual(["a", "b"]);
    expect(bodyToParagraphTexts("   ")).toEqual([]);
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
