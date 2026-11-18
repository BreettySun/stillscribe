import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
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

  it("outputs 往返；未传 outputs 的 update 不清空它", () => {
    const s = freshStore();
    const t = s.create(PARAMS);
    const outputs = { docx: "/w/a.docx", markdown: "/w/a.md", html: "/w/a.html" };
    expect(s.update(t.id, { outputs }).outputs).toEqual(outputs);
    expect(s.update(t.id, { status: "completed" }).outputs).toEqual(outputs);
  });

  it("旧库迁移：补 outputs 列，遗留的 outputDocx 读成 outputs.docx", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "stillscribe-store-"));
    const file = path.join(dir, "tasks.db");
    // 按旧版表结构（含 outputDocx / feishuUrl，无 outputs）造一条已完成的任务。
    const old = new Database(file);
    old.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, params TEXT NOT NULL, status TEXT NOT NULL, currentStep TEXT,
        videoTitle TEXT, workDir TEXT NOT NULL DEFAULT '', article TEXT, outputDocx TEXT,
        feishuUrl TEXT, error TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
    `);
    old
      .prepare(
        `INSERT INTO tasks (id, params, status, workDir, outputDocx, feishuUrl, createdAt, updatedAt)
         VALUES ('t1', ?, 'completed', '/w', '/w/article/article_final.docx', 'https://example/doc', 'now', 'now')`,
      )
      .run(JSON.stringify(PARAMS));
    old.close();

    const s = new TaskStore(file);
    const t = s.get("t1")!;
    expect(t.outputs).toEqual({ docx: "/w/article/article_final.docx" });
    expect(t).not.toHaveProperty("feishuUrl");
    // 迁移后可正常写入新结构。
    const u = s.update("t1", { outputs: { ...t.outputs, markdown: "/w/article/article.md" } });
    expect(u.outputs).toEqual({ docx: "/w/article/article_final.docx", markdown: "/w/article/article.md" });
    s.close();
  });

  it("update 不存在的 id 抛错", () => {
    const s = freshStore();
    expect(() => s.update("nope", { status: "running" })).toThrow();
  });
});
