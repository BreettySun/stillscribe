/**
 * M8 文档组装：读 M7 的 Article，用 dolanmiu `docx` 程序化一次性生成 article_final.docx。
 *
 * 每页：Heading2 小标题 → HD 配图（等比居中，配图源取 01_hd 的 1280×720 jpg）→ 正文分段。
 * 文末：Meta（候选标题 / 关键词 / 描述）。
 * 铁律 #4：ArticleNotes（中文说明 / CoT）绝不进 docx —— 本模块直接忽略 article.notes。
 * 缺图：记 warning、跳过该图、不中断。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	Document,
	Packer,
	Paragraph,
	ImageRun,
	HeadingLevel,
	AlignmentType,
} from "docx";
import type { Article } from "@shared/types";

// M3 保证 HD 恒为 1280×720；固定 6 英寸宽等比（@96dpi，16:9）。
const IMG_W = 576;
const IMG_H = 324;

/** 正文按空行切段、去空白段（纯函数，便于单测）。 */
export function bodyToParagraphTexts(body: string): string[] {
	return body
		.split("\n\n")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
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
): Promise<DocxBuild> {
	const warnings: string[] = [];
	const children: Paragraph[] = [];

	for (const page of article.pages) {
		children.push(
			new Paragraph({ heading: HeadingLevel.HEADING_4, text: page.subhead }),
		);

		const imgPath = path.join(hdDir, `${page.image}.jpg`);
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
			warnings.push(`配图缺失，已跳过: ${page.image}（页 "${page.subhead}"）`);
		}

		for (const text of bodyToParagraphTexts(page.body)) {
			children.push(new Paragraph({ text }));
		}
	}

	const { meta } = article;
	children.push(
		new Paragraph({ heading: HeadingLevel.HEADING_4, text: "Meta" }),
	);
	children.push(new Paragraph({ text: "Titles: " + meta.titles.join(" | ") }));
	children.push(
		new Paragraph({ text: "Keywords: " + meta.keywords.join(", ") }),
	);
	children.push(new Paragraph({ text: "Description: " + meta.description }));

	const doc = new Document({ sections: [{ children }] });
	const buffer = await Packer.toBuffer(doc);
	return { buffer, warnings };
}
