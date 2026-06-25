/**
 * M8 文档组装：读 M7 的 Article，用 dolanmiu `docx` 程序化一次性生成 article_final.docx。
 *
 * 版式对齐 template.md（飞书云文档成品格式）：
 * 顶部元信息块（加粗标签 + 值）：
 *   Source / Title（保留全部候选，一行一个）/ Keywords / Description /
 *   Cover: 420*315, jpg（纯文字标注占位，不嵌图）/ Content（引言：配图 + 正文，无编号标题）。
 * 其后为编号小节：加粗编号小标题（普通段落，非 Heading）→ HD 配图（等比居中，源取 01_hd 1280×720 jpg）→ 正文分段。
 * 引言页约定为 pages[0]（M7 prompt 保证首页为 Intro），其配图嵌在 Content 文字上方、不加编号标题。
 *
 * 铁律 #4：ArticleNotes（中文说明 / CoT）绝不进 docx —— 本模块直接忽略 article.notes。
 * 缺图：记 warning、跳过该图、不中断。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	Document,
	Packer,
	Paragraph,
	TextRun,
	ImageRun,
	AlignmentType,
} from "docx";
import type { Article } from "@shared/types";

// M3 保证 HD 恒为 1280×720；固定 6 英寸宽等比（@96dpi，16:9）。
const IMG_W = 576;
const IMG_H = 324;

/** 封面尺寸标注（纯文字占位，不做真实缩图，图由人工放）。 */
const COVER_LABEL = "Cover: 420*315, jpg";

/** 正文按空行切段、去空白段（纯函数，便于单测）。 */
export function bodyToParagraphTexts(body: string): string[] {
	return body
		.split("\n\n")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * docx 版面块（中间表示）：纯数据，便于单测断言顺序/标签/标题，与 docx Paragraph 构造解耦。
 * - para：一段文本；bold 为加粗标签/小标题。
 * - image：引用某帧时间戳，由渲染层读 01_hd 对应 jpg。
 */
export type DocxBlock =
	| { kind: "para"; text: string; bold?: boolean }
	| { kind: "image"; image: string };

/** 纯函数：按 template.md 版式把 Article 摊平成有序块清单。 */
export function buildDocxBlocks(article: Article, sourceUrl?: string): DocxBlock[] {
	const { pages, meta } = article;
	const blocks: DocxBlock[] = [];
	const label = (text: string) => blocks.push({ kind: "para", text, bold: true });
	const value = (text: string) => blocks.push({ kind: "para", text });

	// 顶部元信息块。
	label("Source:");
	value(sourceUrl ?? "");

	label("Title:");
	for (const t of meta.titles) value(t); // 保留全部候选，一行一个

	label("Keywords:");
	value(meta.keywords.join(", "));

	label("Description:");
	value(meta.description);

	label(COVER_LABEL); // 仅文字标注占位，无图

	// 引言：pages[0] 的配图嵌在 Content 文字上方，正文随后，无编号标题。
	label("Content:");
	const intro = pages[0];
	if (intro) {
		blocks.push({ kind: "image", image: intro.image });
		for (const text of bodyToParagraphTexts(intro.body)) value(text);
	}

	// 编号小节：pages[1..]，编号已含在 subhead 内。
	for (const page of pages.slice(1)) {
		blocks.push({ kind: "para", text: page.subhead, bold: true });
		blocks.push({ kind: "image", image: page.image });
		for (const text of bodyToParagraphTexts(page.body)) value(text);
	}

	return blocks;
}

async function readImageIfExists(p: string): Promise<Buffer | null> {
	try {
		return await readFile(p);
	} catch {
		return null;
	}
}

export interface DocxBuild {
	/** docx 二进制内容（buffer-first：既可落盘留底，也可直接喂飞书导入，见《飞书集成》§2）。 */
	buffer: Buffer;
	/** 缺图清单。 */
	warnings: string[];
}

/** 生成 docx，返回内存 buffer + warnings（缺图清单）。落盘与否由调用方（runDocx）决定。 */
export async function buildDocx(
	article: Article,
	hdDir: string,
	opts?: { sourceUrl?: string },
): Promise<DocxBuild> {
	const warnings: string[] = [];
	const children: Paragraph[] = [];

	for (const block of buildDocxBlocks(article, opts?.sourceUrl)) {
		if (block.kind === "para") {
			children.push(
				new Paragraph({ children: [new TextRun({ text: block.text, bold: block.bold })] }),
			);
			continue;
		}

		const imgPath = path.join(hdDir, `${block.image}.jpg`);
		const data = await readImageIfExists(imgPath);
		if (data) {
			children.push(
				new Paragraph({
					alignment: AlignmentType.CENTER,
					children: [
						new ImageRun({
							type: "jpg",
							data,
							transformation: { width: IMG_W, height: IMG_H },
						}),
					],
				}),
			);
		} else {
			warnings.push(`配图缺失，已跳过: ${block.image}`);
		}
	}

	const doc = new Document({ sections: [{ children }] });
	const buffer = await Packer.toBuffer(doc);
	return { buffer, warnings };
}
