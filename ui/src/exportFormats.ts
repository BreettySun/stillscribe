/**
 * 导出格式的展示信息（标签 / 说明）与取用辅助。
 * 格式集合与产物结构以 @shared/types 为准（铁律 #3），这里只补 UI 文案。
 */
import { EXPORT_FORMATS, type ExportFormat, type ExportOutputs } from "@shared/types";

export const EXPORT_FORMAT_INFO: Record<ExportFormat, { label: string; hint: string }> = {
	docx: { label: "Word", hint: "配图内嵌" },
	markdown: { label: "Markdown", hint: "article.md + images/，标题与关键词在 front matter" },
	html: { label: "HTML", hint: "article.html + images/，另有图片内嵌的单文件版" },
};

export interface ExportOutputRow {
	format: ExportFormat;
	label: string;
	hint: string;
	path: string;
}

/** 已导出的格式，按 EXPORT_FORMATS 的固定顺序排列。 */
export function listOutputs(outputs: ExportOutputs | undefined): ExportOutputRow[] {
	return EXPORT_FORMATS.flatMap((format) => {
		const path = outputs?.[format];
		return path ? [{ format, ...EXPORT_FORMAT_INFO[format], path }] : [];
	});
}
