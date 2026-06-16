/**
 * 事件总线：引擎 → UI 的 EngineEvent 推送中枢。SSE 客户端订阅，编排器/服务发布。
 * 与 shared/types.ts 的 EngineEvent 契约对齐。
 */
import type { EngineEvent } from "@shared/types";

type Listener = (e: EngineEvent) => void;

export class EventBus {
  private readonly listeners = new Set<Listener>();

  /** 订阅；返回取消订阅函数。 */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(e: EngineEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        // 单个订阅者（如已断开的 SSE 连接）出错不应影响其他订阅者。
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
