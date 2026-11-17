import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EngineEvent } from "@shared/types";
import { canTransition, Orchestrator } from "./queue.ts";
import { EventBus } from "./events.ts";
import { TaskStore } from "../store/tasks.ts";
import { TaskDir } from "../paths.ts";

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
    expect(canTransition("completed", "running")).toBe(true); // 原样重新导出
    expect(canTransition("failed", "awaiting_review")).toBe(true); // 导出失败后返回校对
    expect(canTransition("canceled", "queued")).toBe(true);
  });

  it("禁止的迁移", () => {
    expect(canTransition("failed", "completed")).toBe(false); // 失败只能重试或回校对
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("completed", "queued")).toBe(false);
    expect(canTransition("canceled", "running")).toBe(false);
  });
});

describe("reopenReview 返回上一步", () => {
  it("completed → awaiting_review，保留 article 与 outputs", async () => {
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
    // 造一个已完成（已导出）的任务。
    const outputs = { docx: "/tmp/a.docx", markdown: "/tmp/a.md" };
    store.update(task.id, { status: "awaiting_review", article });
    store.update(task.id, { status: "completed", outputs });

    const reopened = orch.reopenReview(task.id);
    expect(reopened.status).toBe("awaiting_review");
    expect(reopened.article).toEqual(article);
    expect(reopened.outputs).toEqual(outputs); // 保留（下次导出覆盖同路径）
  });

  it("导出阶段失败 reopenReview：failed → awaiting_review，保留 article、清 error", async () => {
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
    // 导出阶段失败：无 outputs。
    store.update(task.id, { status: "awaiting_review", article });
    store.update(task.id, { status: "failed", error: "导出失败" });

    const reopened = orch.reopenReview(task.id);
    expect(reopened.status).toBe("awaiting_review");
    expect(reopened.article).toEqual(article);
    expect(reopened.error).toBeUndefined();
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

describe("exportArticle 导出本地文件", () => {
  const ARTICLE = {
    pages: [
      { subhead: "Intro", image: "00_00_01", body: "Hello." },
      { subhead: "1. First Stop", image: "00_00_02", body: "World." },
    ],
    meta: { titles: ["T1", "T2"], keywords: ["k"], description: "d" },
    notes: { imageRationale: "中文选图理由" },
  };

  /** 造一个停在 awaiting_review、带 article 与（假）HD 帧的任务。 */
  async function setup() {
    const workDir = await mkdtemp(path.join(tmpdir(), "diggo-orch-"));
    const td = new TaskDir(workDir);
    await mkdir(td.hd, { recursive: true });
    await writeFile(path.join(td.hd, "00_00_01.jpg"), "frame-1");
    // 00_00_02 故意不放 → 缺图 warning。

    const store = new TaskStore(":memory:");
    const bus = new EventBus();
    const events: EngineEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const orch = new Orchestrator(store, bus, { workRoot: tmpdir() });
    const task = store.create({ url: "https://youtu.be/x", quality: 1080, dedup: true, mode: "semi" });
    store.update(task.id, { status: "awaiting_review", workDir, article: ARTICLE, videoTitle: "vid" });
    return { store, orch, events, td, id: task.id };
  }

  it("默认导出全部格式：落 completed、记录 outputs、缺图只报一次 warning", async () => {
    const { store, orch, events, td, id } = await setup();
    const { outputs, warnings } = await orch.exportArticle(id);

    expect(outputs).toEqual({ docx: td.docx, markdown: td.markdown, html: td.html });
    expect(warnings).toEqual(["配图缺失，已跳过: 00_00_02"]);
    for (const f of [td.docx, td.markdown, td.html, td.htmlStandalone]) expect(existsSync(f)).toBe(true);
    expect(await readdir(td.exportImages)).toEqual(["00-intro.jpg"]);

    const md = await readFile(td.markdown, "utf-8");
    expect(md).toContain('title: "T1"');
    expect(md).toContain("![T1](images/00-intro.jpg)");
    expect(md).not.toContain("中文"); // notes 不进导出文件（铁律 #4）

    // 单文件版内嵌图片原字节（base64），不引用 images/。
    const standalone = await readFile(td.htmlStandalone, "utf-8");
    expect(standalone).toContain(`data:image/jpeg;base64,${Buffer.from("frame-1").toString("base64")}`);
    expect(standalone).not.toContain('src="images/');

    const after = store.get(id)!;
    expect(after.status).toBe("completed");
    expect(after.outputs).toEqual(outputs);
    expect(after.currentStep).toBeUndefined();
    expect(events.at(-1)).toEqual({ type: "completed", taskId: id, outputs });
  });

  it("已完成的任务可只重导部分格式，其余格式的产物路径保留", async () => {
    const { store, orch, td, id } = await setup();
    await orch.exportArticle(id);
    const { outputs } = await orch.exportArticle(id, ["markdown"]);

    expect(outputs).toEqual({ markdown: td.markdown });
    expect(store.get(id)!.status).toBe("completed");
    expect(store.get(id)!.outputs).toEqual({ docx: td.docx, markdown: td.markdown, html: td.html });
  });

  it("非校对中/已完成的任务拒绝导出，状态不变", async () => {
    const { store, orch, id } = await setup();
    store.update(id, { status: "failed", error: "boom" });
    await expect(orch.exportArticle(id)).rejects.toThrow("仅校对中或已完成");
    expect(store.get(id)!.status).toBe("failed");
  });
});
