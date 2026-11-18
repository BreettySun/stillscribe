/**
 * 「测试连接」：两步探测当前模型服务。
 * 1) 纯文本请求——能否连通、Key 是否有效；
 * 2) 带图的结构化请求——模型能否看图、结构化输出到哪一级（总是从 json_schema 起步重新探测）。
 * 从不抛错：所有失败写进 error（AIRequestError 的文案已不含 Key）。
 */
import type { AITestResult } from "@shared/types";
import type { ResolvedAIConfig } from "./aiConfig.ts";
import { AIRequestError, chatJson, chatText, type ChatOptions } from "./chat.ts";
import { parseModelJson } from "./parse.ts";

/** 64×64 纯红 PNG */
const RED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc8OJg6Ln3AAAAAElFTkSuQmCC";

const COLOR_SCHEMA = {
  name: "color_check",
  schema: { type: "object", properties: { color: { type: "string" } }, required: ["color"] },
};

const NOT_READY_ERROR = "尚未配置该地址的 API Key";
const UNEXPECTED_ERROR = "测试连接时发生未知错误";

function seesRed(content: string): boolean {
  try {
    const parsed = parseModelJson(content.trim()) as { color?: unknown } | null;
    return typeof parsed?.color === "string" && parsed.color.toLowerCase().includes("red");
  } catch {
    return false;
  }
}

export async function testConnection(cfg: ResolvedAIConfig): Promise<AITestResult> {
  if (!cfg.ready) {
    return { ok: false, seesImage: null, structuredMode: null, latencyMs: 0, error: NOT_READY_ERROR };
  }
  const opts: ChatOptions = { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, timeoutMs: 60_000 };
  const started = Date.now();
  const latency = () => Date.now() - started;
  const errorText = (e: unknown) => (e instanceof AIRequestError ? e.message : UNEXPECTED_ERROR);

  try {
    await chatText(opts, [{ type: "text", text: "Reply with the single word: ok" }]);
  } catch (e) {
    return { ok: false, seesImage: null, structuredMode: null, latencyMs: latency(), error: errorText(e) };
  }

  try {
    const { content, mode } = await chatJson(opts, {
      parts: [
        {
          type: "text",
          text: "What is the dominant color of this image? Answer with one lowercase English word.",
        },
        { type: "image", base64: RED_PNG_BASE64, mimeType: "image/png" },
      ],
      // 不从已记住的级别起步：每次都从 json_schema 重新探测，结果由调用方覆盖记住的级别，
      // 这样一次偶发的 400 造成的降级可以靠"保存并测试"恢复。
      schema: COLOR_SCHEMA,
    });
    return { ok: true, seesImage: seesRed(content), structuredMode: mode, latencyMs: latency() };
  } catch (e) {
    return { ok: false, seesImage: null, structuredMode: null, latencyMs: latency(), error: errorText(e) };
  }
}
