/**
 * M8 Markdown 导出：front matter（标题 / description / 关键词 / 候选标题 / 来源）+ 正文。
 *
 * 版式：
 *   - 标题只进 front matter，不在正文重复一遍 H1（静态站与 CMS 都从 front matter / 标题栏取标题）。
 *   - 引言：配图 + 段落，无小标题。
 *   - 其后各节：`## 小标题` → 配图 → 段落。
 *   - 配图以相对路径引用（images/<文件名>），与 article.md 同目录即可用。
 *
 * 正文是纯文本，写入前做 Markdown 转义，避免 `*`、`_`、行首 `#` 等被当成标记。
 */
import { EXPORT_IMAGES_DIRNAME } from "../paths.ts";
import type { ExportDoc } from "./m8-layout.ts";

/** 行内转义：标记字符与 HTML 实体写法。用于不在行首的文本（标题、alt）。 */
export function escapeMarkdownInline(text: string): string {
	return (
		text
			// 行内标记字符。
			.replace(/([\\`*_[\]<>])/g, "\\$1")
			// 形如 &copy; / &#169; 的实体。
			.replace(/&(?=#?\w+;)/g, "\\&")
	);
}

/** 把一段纯文本转义成"按字面显示"的 Markdown：行内转义 + 行首块级标记。 */
export function escapeMarkdown(text: string): string {
	return (
		escapeMarkdownInline(text)
			// 行首的块级标记：标题、无序列表。
			.replace(/^(\s*)([#+-])(?=\s)/gm, "$1\\$2")
			// 行首的有序列表编号。
			.replace(/^(\s*\d+)([.)])(?=\s)/gm, "$1\\$2")
			// 整行都是 - 或 =（会被当成分隔线 / Setext 标题下划线）。
			.replace(/^(\s*)([-=]+)(\s*)$/gm, "$1\\$2$3")
	);
}

/** YAML 标量：JSON 字符串字面量同时是合法的 YAML 双引号标量。 */
function yamlString(s: string): string {
	return JSON.stringify(s);
}

function yamlList(items: string[]): string {
	return `[${items.map(yamlString).join(", ")}]`;
}

export function renderMarkdown(
	doc: ExportDoc,
	opts?: { missing?: ReadonlySet<string> },
): string {
	const front = [
		"---",
		`title: ${yamlString(doc.title)}`,
		`description: ${yamlString(doc.description)}`,
		`keywords: ${yamlList(doc.keywords)}`,
		...(doc.altTitles.length > 0 ? [`alt_titles: ${yamlList(doc.altTitles)}`] : []),
		...(doc.sourceUrl ? [`source: ${yamlString(doc.sourceUrl)}`] : []),
		"---",
	].join("\n");

	const blocks: string[] = [front];
	for (const section of doc.sections) {
		if (section.heading) blocks.push(`## ${escapeMarkdownInline(section.heading)}`);
		if (!opts?.missing?.has(section.image.fileName)) {
			blocks.push(
				`![${escapeMarkdownInline(section.image.alt)}](${EXPORT_IMAGES_DIRNAME}/${section.image.fileName})`,
			);
		}
		for (const p of section.paragraphs) blocks.push(escapeMarkdown(p));
	}
	return `${blocks.join("\n\n")}\n`;
}
