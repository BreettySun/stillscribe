/**
 * M7 提示词渲染。与半自动【同一套模板】（AI 集成文档 §1）。
 *
 * 【占位】真正的 Gemini Prompt 是已调好的资产（CLAUDE.md §8：不要重写已调好的 Prompt，
 * 只在其基础上改造成 JSON 输出）。此处先放占位模板，待录入既有 Prompt：
 *   把它落到本目录的 `prompt.template.txt`，本模块会自动优先读取该文件。
 *
 * 注意：字幕作为独立 content part 发给模型（见 geminiClient），不在提示词里内联，
 * 故模板变量不含 subtitles，只含视频元信息与帧数提示。
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** 真·Prompt 落盘点：存在即覆盖占位模板（dev 下读源文件）。 */
export const PROMPT_TEMPLATE_FILE = path.join(here, "prompt.template.txt");

/**
 * 打包时由 esbuild define 注入的真模板常量（见 electron/scripts/build-engine.mjs）。
 * dev/tsx 下该标识符不存在——`typeof` 守卫保证不抛错（返回 "undefined"），从而回退到读源 .txt。
 */
declare const __STILLSCRIBE_PROMPT_TEMPLATE__: string | undefined;

export interface PromptVars {
  /** 视频标题。 */
  videoTitle: string;
  /** 提供给模型的图片张数（代表帧或宫格图）。 */
  imageCount: number;
}

/** 占位模板：表达结构与边界，待替换为既有半自动 Prompt 的 JSON 输出版。 */
const PLACEHOLDER_TEMPLATE = `【占位提示词 — 待录入既有半自动同款 Gemini Prompt（见 CLAUDE.md §8 / AI 集成文档 §1）】

你将看到一段视频字幕（随后作为独立内容传入）与 {{imageCount}} 张取自视频《{{videoTitle}}》的画面。
请据此生成一篇结构化图文文章，并严格按系统约定的 JSON Schema 输出（不要输出 Schema 之外的任何文本）。

要求：
- 每页给出小标题(subhead)、一张配图(image，取你看到的画面对应的 HH_MM_SS 时间戳)、正文(body)。
- 正文(body)必须是纯净的发布内容，禁止混入任何说明性中文或思维链。
- 任何中文说明 / 配图理由 / 框架取舍，只能放进 notes 字段。
- meta 给出候选标题(titles)、关键词(keywords)、摘要(description)。`;

/**
 * 解析默认提示词模板（未做 {{var}} 替换）。取模板优先级：
 *   1) 打包时烤入的 __STILLSCRIBE_PROMPT_TEMPLATE__（packaged）；
 *   2) 源 prompt.template.txt（dev，单一事实来源）；
 *   3) 占位模板（都没有时兜底）。
 */
export async function loadPromptTemplate(): Promise<string> {
  if (typeof __STILLSCRIBE_PROMPT_TEMPLATE__ === "string" && __STILLSCRIBE_PROMPT_TEMPLATE__) {
    return __STILLSCRIBE_PROMPT_TEMPLATE__;
  }
  if (existsSync(PROMPT_TEMPLATE_FILE)) {
    return readFile(PROMPT_TEMPLATE_FILE, "utf-8");
  }
  return PLACEHOLDER_TEMPLATE;
}

/**
 * 渲染提示词。模板来源：传入 `override` 则以它为模板（本次提交的自定义提示词），
 * 否则取默认模板（见 loadPromptTemplate）。两者都支持 {{var}} 占位替换。
 */
export async function renderPrompt(vars: PromptVars, override?: string): Promise<string> {
  const tpl = override != null && override !== "" ? override : await loadPromptTemplate();
  const dict = vars as unknown as Record<string, unknown>;
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => {
    const v = dict[k];
    return v == null ? "" : String(v);
  });
}
