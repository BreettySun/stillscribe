import { describe, it, expect } from "vitest";
import type { TaskParams } from "@shared/types";
import { TaskStore } from "./tasks.ts";

const PARAMS: TaskParams = { url: "https://x", quality: 1080, dedup: true, mode: "semi" };

function freshStore(): TaskStore {
  return new TaskStore(":memory:");
}

describe("TaskStore", () => {
  it("create → queued, params 往返，时间戳齐全", () => {
    const s = freshStore();
    const t = s.create(PARAMS);
    expect(t.status).toBe("queued");
    expect(t.params).toEqual(PARAMS);
    expect(t.workDir).toBe("");
    expect(t.createdAt).toBeTruthy();
    expect(s.get(t.id)).toEqual(t);
  });

  it("list 按 createdAt 升序", () => {
    const s = freshStore();
    const a = s.create(PARAMS);
    const b = s.create(PARAMS);
    const ids = s.list().map((t) => t.id);
    expect(ids).toEqual([a.id, b.id]);
  });

  it("update 合并 + article/JSON 往返", () => {
    const s = freshStore();
    const t = s.create(PARAMS);
    const article = {
      pages: [{ subhead: "S", image: "00_00_01", body: "B" }],
      meta: { titles: ["T"], keywords: ["k"], description: "d" },
    };
    const u = s.update(t.id, { status: "awaiting_review", article, videoTitle: "vid" });
    expect(u.status).toBe("awaiting_review");
    expect(u.article).toEqual(article);
    expect(u.videoTitle).toBe("vid");
    expect(u.updatedAt >= t.updatedAt).toBe(true);
  });

  it("update 用 null 清空 error/article/currentStep", () => {
    const s = freshStore();
    const t = s.create(PARAMS);
    s.update(t.id, { error: "boom", currentStep: "frames" });
    expect(s.get(t.id)!.error).toBe("boom");
    const cleared = s.update(t.id, { error: null, currentStep: null });
    expect(cleared.error).toBeUndefined();
    expect(cleared.currentStep).toBeUndefined();
  });

  it("update 不存在的 id 抛错", () => {
    const s = freshStore();
    expect(() => s.update("nope", { status: "running" })).toThrow();
  });
});
