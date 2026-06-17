/**
 * SSE 订阅：连接引擎 /api/events，逐条解析 EngineEvent 回调。
 * 断线自动重连由浏览器 EventSource 处理；onOpen/onError 透出连接状态供 engineStore 驱动状态灯。
 * 返回 disconnect 供组件卸载时清理。
 */
import type { EngineEvent } from "@shared/types";
import { engineOrigin } from "../bridge";

export interface EventHandlers {
  onEvent: (e: EngineEvent) => void;
  onOpen?: () => void;
  onError?: () => void;
}

export function connectEvents(handlers: EventHandlers): () => void {
  const source = new EventSource(`${engineOrigin}/events`);
  source.onopen = () => handlers.onOpen?.();
  source.onerror = () => handlers.onError?.();
  source.onmessage = (msg) => {
    try {
      handlers.onEvent(JSON.parse(msg.data) as EngineEvent);
    } catch {
      /* 心跳/注释行非 JSON，忽略 */
    }
  };
  return () => source.close();
}
