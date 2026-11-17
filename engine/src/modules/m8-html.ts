/**
 * M8 HTML 导出：一份完整、可直接打开的 HTML 文档。
 *
 *   - <head>：title、description、keywords；其余候选标题与来源视频以 <meta> 记录（不进正文）。
 *   - <body>：<article> 内 h1 → 引言（配图 + 段落）→ 各节 <section>（h2 → 配图 → 段落）。
 *   - 配图地址由 imageSrc 决定：默认相对路径 images/<文件名>；单文件版传入 data URI。
 *
 * 样式只有一小段排版用的内联 CSS，不引任何外部资源（文件离线可看，也不产生出站请求）。
 */
import { EXPORT_IMAGES_DIRNAME } from "../paths.ts";
import type { ExportDoc, ExportImage } from "./m8-layout.ts";

// M3 保证 HD 帧恒为 1280×720；写进 width/height 让浏览器预留版位。
const IMG_W = 1280;
const IMG_H = 720;

const STYLE = [
	"body{margin:0;font:17px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2328;background:#fff}",
	"article{max-width:720px;margin:0 auto;padding:40px 20px 64px}",
	"h1{font-size:32px;line-height:1.25;margin:0 0 24px}",
	"h2{font-size:22px;line-height:1.35;margin:40px 0 16px}",
	"p{margin:0 0 16px}",
	"figure{margin:0 0 16px}",
	"img{display:block;max-width:100%;height:auto;border-radius:6px}",
].join("");

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export interface RenderHtmlOptions {
	/** 未能拷出的配图文件名：跳过不渲染。 */
	missing?: ReadonlySet<string>;
	/** 配图地址；省略则用相对路径 images/<文件名>。 */
	imageSrc?: (image: ExportImage) => string;
}

export function renderHtml(doc: ExportDoc, opts?: RenderHtmlOptions): string {
	const src = opts?.imageSrc ?? ((image: ExportImage) => `${EXPORT_IMAGES_DIRNAME}/${image.fileName}`);
	const meta = (name: string, content: string) =>
		`<meta name="${name}" content="${escapeHtml(content)}">`;

	const head = [
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<title>${escapeHtml(doc.title)}</title>`,
		meta("description", doc.description),
		...(doc.keywords.length > 0 ? [meta("keywords", doc.keywords.join(", "))] : []),
		...doc.altTitles.map((t) => meta("alternate-title", t)),
		...(doc.sourceUrl ? [meta("dcterms.source", doc.sourceUrl)] : []),
		`<style>${STYLE}</style>`,
	];

	const body: string[] = [`<h1>${escapeHtml(doc.title)}</h1>`];
	for (const section of doc.sections) {
		const inner: string[] = [];
		if (section.heading) inner.push(`<h2>${escapeHtml(section.heading)}</h2>`);
		if (!opts?.missing?.has(section.image.fileName)) {
			inner.push(
				`<figure><img src="${escapeHtml(src(section.image))}" alt="${escapeHtml(section.image.alt)}" width="${IMG_W}" height="${IMG_H}"></figure>`,
			);
		}
		for (const p of section.paragraphs) inner.push(`<p>${escapeHtml(p)}</p>`);
		body.push(`<section>\n${inner.join("\n")}\n</section>`);
	}

	return [
		"<!doctype html>",
		"<html>",
		"<head>",
		...head,
		"</head>",
		"<body>",
		"<article>",
		...body,
		"</article>",
		"</body>",
		"</html>",
		"",
	].join("\n");
}
