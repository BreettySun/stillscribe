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
    expect(canTransition("completed", "awaiting_review")).toBe(true); // 返回上一步
    expect(canTransition("failed", "queued")).toBe(true); // 重试
    expect(canTransition("failed", "awaiting_review")).toBe(true); // docx 失败后返回校对
    expect(canTransition("failed", "completed")).toBe(true); // 飞书失败后返回 docx 结果页
    expect(canTransition("canceled", "queued")).toBe(true);
  });

  it("禁止的迁移", () => {
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("completed", "queued")).toBe(false);
    expect(canTransition("canceled", "running")).toBe(false);
  });
});

describe("reopenReview 返回上一步", () => {
  it("completed → awaiting_review，保留 article、清 feishuUrl", async () => {
    const { Orchestrator } = await import("./queue.ts");
    const { EventBus } = await import("./events.ts");
    const { TaskStore } = await import("../store/tasks.ts");

    const store = new TaskStore(":memory:");
    const bus = new EventBus();
    const orch = new Orchestrator(store, bus, { workRoot: "/tmp" });

    const task = store.create({ url: "https://x", quality: 1080, dedup: true, mode: "semi" });
    const article = {
      pages: [{ subhead: "s", image: "00_00_01", body: "b" }],
      meta: { titles: ["t"], keywords: ["k"], description: "d" },
    };
    // 造一个已完成（带 feishuUrl）的任务。
    store.update(task.id, { status: "awaiting_review", article });
    store.update(task.id, { status: "completed", outputDocx: "/tmp/a.docx", feishuUrl: "https://feishu/doc-1" });

    const reopened = orch.reopenReview(task.id);
    expect(reopened.status).toBe("awaiting_review");
    expect(reopened.article).toEqual(article);
    expect(reopened.feishuUrl).toBeUndefined(); // 已清空
    expect(reopened.outputDocx).toBe("/tmp/a.docx"); // 保留
  });

  it("docx 阶段失败 reopenReview：failed → awaiting_review，保留 article、清 error", async () => {
    const { Orchestrator } = await import("./queue.ts");
    const { EventBus } = await import("./events.ts");
    const { TaskStore } = await import("../store/tasks.ts");

    const store = new TaskStore(":memory:");
    const orch = new Orchestrator(store, new EventBus(), { workRoot: "/tmp" });
    const task = store.create({ url: "https://x", quality: 1080, dedup: true, mode: "auto" });
    const article = {
      pages: [{ subhead: "s", image: "00_00_01", body: "b" }],
      meta: { titles: ["t"], keywords: ["k"], description: "d" },
    };
    // docx 生成阶段失败：无 outputDocx。
    store.update(task.id, { status: "awaiting_review", article });
    store.update(task.id, { status: "failed", error: "docx 生成失败" });

    const reopened = orch.reopenReview(task.id);
    expect(reopened.status).toBe("awaiting_review");
    expect(reopened.article).toEqual(article);
    expect(reopened.error).toBeUndefined();
  });

  it("飞书失败 reopenDocxResult：failed → completed，保留 docx、清 error/feishuUrl", async () => {
    const { Orchestrator } = await import("./queue.ts");
    const { EventBus } = await import("./events.ts");
    const { TaskStore } = await import("../store/tasks.ts");

    const store = new TaskStore(":memory:");
    const orch = new Orchestrator(store, new EventBus(), { workRoot: "/tmp" });
    const task = store.create({ url: "https://x", quality: 1080, dedup: true, mode: "auto" });
    const article = {
      pages: [{ subhead: "s", image: "00_00_01", body: "b" }],
      meta: { titles: ["t"], keywords: ["k"], description: "d" },
    };
    // docx 留底成功、飞书导入失败落 failed。
    store.update(task.id, { status: "awaiting_review", article });
    store.update(task.id, { status: "completed", outputDocx: "/tmp/a.docx" });
    store.update(task.id, { status: "failed", error: "飞书上传失败：code=1061045" });

    const reopened = orch.reopenDocxResult(task.id);
    expect(reopened.status).toBe("completed");
    expect(reopened.outputDocx).toBe("/tmp/a.docx");
    expect(reopened.error).toBeUndefined();
    expect(reopened.feishuUrl).toBeUndefined();
  });

  it("无 docx 产物时 reopenDocxResult 拒绝", async () => {
    const { Orchestrator } = await import("./queue.ts");
    const { EventBus } = await import("./events.ts");
    const { TaskStore } = await import("../store/tasks.ts");
    const store = new TaskStore(":memory:");
    const orch = new Orchestrator(store, new EventBus(), { workRoot: "/tmp" });
    const task = store.create({ url: "https://x", quality: 1080, dedup: true, mode: "auto" });
    store.update(task.id, { status: "awaiting_review" });
    store.update(task.id, { status: "failed", error: "docx 生成失败" });
    expect(() => orch.reopenDocxResult(task.id)).toThrow("无 docx 产物");
  });

  it("无 article 时拒绝", async () => {
    const { Orchestrator } = await import("./queue.ts");
    const { EventBus } = await import("./events.ts");
    const { TaskStore } = await import("../store/tasks.ts");

    const store = new TaskStore(":memory:");
    const orch = new Orchestrator(store, new EventBus(), { workRoot: "/tmp" });
    const task = store.create({ url: "https://x", quality: 1080, dedup: true, mode: "semi" });
    store.update(task.id, { status: "awaiting_review" });
    store.update(task.id, { status: "completed" });
    expect(() => orch.reopenReview(task.id)).toThrow("无 article");
  });
});
