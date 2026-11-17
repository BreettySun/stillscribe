/**
 * M8 Markdown/HTML 导出的共用中间表示：把 Article 摊平成"标题 + 元信息 + 有序小节"，
 * 并为每页配图规划一个面向发布的文件名与 alt 文本。纯数据、纯函数，便于单测。
 *
 * 约定与 m8-docx 一致：pages[0] 是引言（无小标题）；其后各页的 subhead 已含编号。
 * 铁律 #4：ArticleNotes（中文说明 / CoT）绝不进任何导出文件 —— 这里直接不读 article.notes。
 * 铁律 #2：配图从 01_hd 原样拷贝（字节不变），不做任何解码/再编码。
 */
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Article, Timestamp } from "@shared/types";
import { bodyToParagraphTexts } from "./m8-docx.ts";

export interface ExportImage {
	/** 帧时间戳（HH_MM_SS），源文件为 01_hd/<timestamp>.jpg。 */
	timestamp: Timestamp;
	/** 导出后的文件名，如 "01-grand-entrance.jpg"（仅 ASCII，适合直接上传 CMS）。 */
	fileName: string;
	/** alt 文本。 */
	alt: string;
}

export interface ExportSection {
	/** 小标题；引言（首节）无小标题。 */
	heading?: string;
	image: ExportImage;
	paragraphs: string[];
}

export interface ExportDoc {
	/** 主标题：首个候选标题。 */
	title: string;
	/** 其余候选标题（供人工挑选，不进正文）。 */
	altTitles: string[];
	description: string;
	keywords: string[];
	/** 来源视频 URL。 */
	sourceUrl?: string;
	sections: ExportSection[];
}

const TIMESTAMP_RE = /^\d{2}_\d{2}_\d{2}$/;
/** 小标题开头的编号，如 "1. " / "12) "。 */
const NUMBERING_RE = /^\s*\d+[.)]\s*/;

/** 文本 → 文件名片段：去编号、去重音、小写、非字母数字转连字符。纯非拉丁文本会得到空串。 */
export function slugify(text: string, maxLen = 60): string {
	return text
		.replace(NUMBERING_RE, "")
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/['’]/g, "") // 撇号直接去掉：architect's → architects，而不是 architect-s
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, maxLen)
		.replace(/-+$/g, "");
}

/** 纯函数：Article → 导出中间表示。 */
export function buildExportDoc(
	article: Article,
	opts?: { sourceUrl?: string; fallbackTitle?: string },
): ExportDoc {
	const { pages, meta } = article;
	const [first, ...rest] = meta.titles.map((t) => t.trim()).filter((t) => t.length > 0);
	const title = first ?? opts?.fallbackTitle ?? "Untitled";

	const sections = pages.map((page, i): ExportSection => {
		const isIntro = i === 0;
		const bare = page.subhead.replace(NUMBERING_RE, "").trim();
		// 文件名：两位页序号 + 小标题 slug；slug 为空（如非拉丁小标题）时退回时间戳，保证唯一且可读。
		const slug = slugify(page.subhead) || page.image;
		return {
			...(isIntro ? {} : { heading: page.subhead.trim() }),
			image: {
				timestamp: page.image,
				fileName: `${String(i).padStart(2, "0")}-${slug}.jpg`,
				alt: isIntro ? title : bare || title,
			},
			paragraphs: bodyToParagraphTexts(page.body),
		};
	});

	return {
		title,
		altTitles: rest,
		description: meta.description.trim(),
		keywords: meta.keywords.map((k) => k.trim()).filter((k) => k.length > 0),
		...(opts?.sourceUrl ? { sourceUrl: opts.sourceUrl } : {}),
		sections,
	};
}

export interface CopiedImages {
	/** 未能拷出的配图文件名（渲染层据此跳过该图）。 */
	missing: Set<string>;
	warnings: string[];
}

/**
 * 把各节配图从 01_hd 拷到导出配图目录并重命名。每次导出先清空目录再重建，
 * 避免换图/改标题后残留旧文件。只删导出目录自身——逐秒全集（01_hd）只读不动（铁律 #5）。
 * 缺图或时间戳非法：记 warning、跳过该图、不中断（与 docx 一致）。
 */
export async function copyExportImages(
	doc: ExportDoc,
	hdDir: string,
	imagesDir: string,
): Promise<CopiedImages> {
	await rm(imagesDir, { recursive: true, force: true });
	await mkdir(imagesDir, { recursive: true });

	const missing = new Set<string>();
	const warnings: string[] = [];
	for (const { image } of doc.sections) {
		// 时间戳来自 article.json（半自动回填时是人工输入）：非 HH_MM_SS 一律拒绝，杜绝拼出目录外路径。
		if (!TIMESTAMP_RE.test(image.timestamp)) {
			missing.add(image.fileName);
			warnings.push(`配图时间戳非法，已跳过: ${image.timestamp}`);
			continue;
		}
		try {
			await copyFile(
				path.join(hdDir, `${image.timestamp}.jpg`),
				path.join(imagesDir, image.fileName),
			);
		} catch {
			missing.add(image.fileName);
			warnings.push(`配图缺失，已跳过: ${image.timestamp}`);
		}
	}
	return { missing, warnings };
}
