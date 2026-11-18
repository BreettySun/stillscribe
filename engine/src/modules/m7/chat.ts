/**
 * 通用 OpenAI 兼容 chat/completions 客户端：只用内置 fetch，不依赖任何厂商 SDK。
 * Key 只出现在 Authorization 请求头；任何错误信息都不含 Key。
 */
import type { AIStructuredMode } from "@shared/types";

export type ChatPart = { type: "text"; text: string } | { type: "image"; base64: string; mimeType: string };

/** aborted：调用方的 signal 取消了请求（如用户取消任务）——不是网络问题，调用方不应重试或降级。 */
export type AIErrorKind =
  | "config"
  | "not_found"
  | "rate_limit"
  | "rejected"
  | "empty"
  | "server"
  | "network"
  | "aborted";

export class AIRequestError extends Error {
  constructor(
    readonly kind: AIErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AIRequestError";
  }
}

export interface ChatOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** 单次请求超时，默认 300_000 */
  timeoutMs?: number;
  /** 调用方的取消信号；触发时中止进行中的请求并抛 kind=aborted。 */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 300_000;
/** 结构化输出的降级顺序 */
const MODE_ORDER: AIStructuredMode[] = ["json_schema", "json_object", "none"];
const AUTH_HINT = /api[\s_-]?key|unauthori[sz]ed|authenticat|permission/i;

/** 请求头里合法的 Key：可见 ASCII（含空格） */
const HEADER_SAFE = /^[\x20-\x7E]+$/;

/** 服务端错误原文：认 `{error:{message}}` 与 Gemini 兼容层的 `[{error:{message}}]`，取不到用前 300 字符 */
function extractServerMessage(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const msg = (first as { error?: { message?: unknown } } | null)?.error?.message;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  } catch {
    // 不是 JSON，走兜底
  }
  return text.slice(0, 300);
}

function redact(s: string, apiKey: string | undefined): string {
  return apiKey ? s.split(apiKey).join("***") : s;
}

function toMessageContent(parts: ChatPart[]) {
  return parts.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image_url", image_url: { url: `data:${p.mimeType};base64,${p.base64}` } },
  );
}

function responseFormat(mode: AIStructuredMode, schema?: { name: string; schema: object }) {
  if (mode === "json_schema" && schema) {
    return { type: "json_schema", json_schema: { name: schema.name, schema: schema.schema } };
  }
  if (mode === "json_object") return { type: "json_object" };
  return undefined;
}

/** 发一次请求，成功返回 content，失败抛 AIRequestError */
async function requestOnce(
  opts: ChatOptions,
  parts: ChatPart[],
  format: Record<string, unknown> | undefined,
): Promise<string> {
  const { apiKey } = opts;
  if (apiKey !== undefined && apiKey !== "" && !HEADER_SAFE.test(apiKey)) {
    throw new AIRequestError("config", "API Key 含有无法放进请求头的字符（只能是英文字母、数字和常见符号），请检查是否复制错了");
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [{ role: "user", content: toMessageContent(parts) }],
  };
  if (format) body.response_format = format;

  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let status: number;
  let text: string;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      // 不跟随重定向：307/308 会把请求体（字幕、帧）连同 Key 重发到用户没配置过的地址，甚至降级到 http（铁律 #6）。
      redirect: "manual",
      signal: opts.signal
        ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
    status = res.status;
    text = await res.text();
  } catch {
    if (opts.signal?.aborted) throw new AIRequestError("aborted", "已取消模型请求");
    // 错误原文可能带地址等细节，统一用固定文案
    throw new AIRequestError("network", "连不上模型服务（网络不通、地址写错或请求超时），请检查网络和服务地址");
  }

  if (status >= 200 && status < 300) return parseSuccess(text, status);
  if (status >= 300 && status < 400) {
    // 不回显 Location：它可能带 query 等细节；用户按服务文档填最终地址即可。
    throw new AIRequestError("config", `地址发生了重定向，请填写最终地址（HTTP ${status}）`, status);
  }

  const serverMsg = redact(extractServerMessage(text), apiKey);
  if (status === 401 || status === 403) {
    throw new AIRequestError("config", `服务拒绝了这个 API Key 或没有访问权限（HTTP ${status}），请检查 Key 与服务地址是否匹配`, status);
  }
  if (status === 400 || status === 422) {
    if (AUTH_HINT.test(text)) {
      throw new AIRequestError("config", `服务提示 API Key 无效或没有权限（HTTP ${status}）：${serverMsg}`, status);
    }
    throw new AIRequestError("rejected", `服务端拒绝了请求内容（HTTP ${status}）：${serverMsg}`, status);
  }
  if (status === 404) {
    throw new AIRequestError("not_found", "找不到接口，服务地址或模型名可能写错了（HTTP 404）", status);
  }
  if (status === 429) {
    throw new AIRequestError("rate_limit", "请求太频繁或额度用完，被服务限流了（HTTP 429），请稍后再试", status);
  }
  throw new AIRequestError("server", `模型服务出错了（HTTP ${status}），请稍后再试`, status);
}

function parseSuccess(text: string, status: number): string {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AIRequestError("not_found", "服务返回的不是接口数据（可能是网页），服务地址多半写错了", status);
  }
  const content = (json as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]?.message
    ?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new AIRequestError("empty", "模型返回了空响应，请换个模型或稍后重试", status);
  }
  return content;
}

/** 纯文本调用：不带 response_format，只发一次 */
export function chatText(opts: ChatOptions, parts: ChatPart[]): Promise<string> {
  return requestOnce(opts, parts, undefined);
}

/**
 * 结构化调用：从 startMode（默认 json_schema）起步，只有 `rejected` 才降一级重试；
 * 各级都被拒绝时抛出第一次的错误。
 */
export async function chatJson(
  opts: ChatOptions,
  req: { parts: ChatPart[]; schema: { name: string; schema: object }; startMode?: AIStructuredMode },
): Promise<{ content: string; mode: AIStructuredMode }> {
  let firstError: AIRequestError | undefined;
  for (const mode of MODE_ORDER.slice(MODE_ORDER.indexOf(req.startMode ?? "json_schema"))) {
    try {
      const content = await requestOnce(opts, req.parts, responseFormat(mode, req.schema));
      return { content, mode };
    } catch (e) {
      if (!(e instanceof AIRequestError) || e.kind !== "rejected") throw e;
      firstError ??= e;
    }
  }
  throw firstError!;
}
