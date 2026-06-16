import { describe, it, expect } from "vitest";
import { canTransition } from "./queue.ts";

describe("canTransition 状态机", () => {
  it("允许的迁移", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "awaiting_review")).toBe(true);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("running", "canceled")).toBe(true);
    expect(canTransition("awaiting_review", "running")).toBe(true);
    expect(canTransition("awaiting_review", "completed")).toBe(true);
    expect(canTransition("failed", "queued")).toBe(true); // 重试
    expect(canTransition("canceled", "queued")).toBe(true);
  });

  it("禁止的迁移", () => {
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("completed", "queued")).toBe(false);
    expect(canTransition("canceled", "running")).toBe(false);
  });
});
