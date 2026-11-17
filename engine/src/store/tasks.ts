/**
 * 任务存储：better-sqlite3 单文件库（CLAUDE.md 铁律 #9 —— 状态归引擎 + SQLite，不用浏览器存储）。
 * JSON 字段（params/article/outputs）按文本列存，读写时序列化。
 *
 * 注：better-sqlite3 是原生模块；P3b/P4 打包需 electron-rebuild 编译，含 .node 的包放 asarUnpack（CLAUDE.md §8）。
 */
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type {
  Article,
  ExportOutputs,
  PipelineStep,
  Task,
  TaskParams,
  TaskStatus,
} from "@shared/types";

interface Row {
  id: string;
  params: string;
  status: string;
  currentStep: string | null;
  videoTitle: string | null;
  workDir: string;
  article: string | null;
  /** 导出产物路径（JSON：ExportOutputs）。 */
  outputs: string | null;
  /** 旧库遗留列：新库不建。仅在 outputs 为空时读它，映射为 outputs.docx。 */
  outputDocx?: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToTask(r: Row): Task {
  const task: Task = {
    id: r.id,
    params: JSON.parse(r.params) as TaskParams,
    status: r.status as TaskStatus,
    workDir: r.workDir,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
  if (r.currentStep) task.currentStep = r.currentStep as PipelineStep;
  if (r.videoTitle) task.videoTitle = r.videoTitle;
  if (r.article) task.article = JSON.parse(r.article) as Article;
  if (r.outputs) task.outputs = JSON.parse(r.outputs) as ExportOutputs;
  else if (r.outputDocx) task.outputs = { docx: r.outputDocx };
  if (r.error) task.error = r.error;
  return task;
}

/** 可更新字段；显式传 null 表示清空（如 error/currentStep）。 */
export interface TaskPatch {
  status?: TaskStatus;
  currentStep?: PipelineStep | null;
  videoTitle?: string;
  workDir?: string;
  article?: Article | null;
  /** 整体替换（不做按格式合并）。 */
  outputs?: ExportOutputs;
  error?: string | null;
}

export class TaskStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id          TEXT PRIMARY KEY,
        params      TEXT NOT NULL,
        status      TEXT NOT NULL,
        currentStep TEXT,
        videoTitle  TEXT,
        workDir     TEXT NOT NULL DEFAULT '',
        article     TEXT,
        outputs     TEXT,
        error       TEXT,
        createdAt   TEXT NOT NULL,
        updatedAt   TEXT NOT NULL
      );
    `);
    // 迁移：旧库补 outputs 列（CREATE TABLE IF NOT EXISTS 不会给已存在的表加列）。
    // 旧库的 outputDocx / feishuUrl 列原样留着不删：outputDocx 读时兜底映射，feishuUrl 不再使用。
    const cols = this.db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "outputs")) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN outputs TEXT`);
    }
  }

  create(params: TaskParams): Task {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO tasks (id, params, status, workDir, createdAt, updatedAt)
         VALUES (@id, @params, 'queued', '', @now, @now)`,
      )
      .run({ id, params: JSON.stringify(params), now });
    return this.get(id)!;
  }

  get(id: string): Task | undefined {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Row | undefined;
    return row ? rowToTask(row) : undefined;
  }

  list(): Task[] {
    const rows = this.db.prepare(`SELECT * FROM tasks ORDER BY createdAt ASC`).all() as Row[];
    return rows.map(rowToTask);
  }

  /** 读-合并-写整行；返回更新后的 Task。id 不存在则抛错。 */
  update(id: string, patch: TaskPatch): Task {
    const current = this.get(id);
    if (!current) throw new Error(`任务不存在: ${id}`);

    const merged = {
      status: patch.status ?? current.status,
      currentStep:
        patch.currentStep === undefined ? current.currentStep ?? null : patch.currentStep,
      videoTitle: patch.videoTitle ?? current.videoTitle ?? null,
      workDir: patch.workDir ?? current.workDir,
      article:
        patch.article === undefined ? current.article ?? null : patch.article,
      outputs: patch.outputs ?? current.outputs ?? null,
      error: patch.error === undefined ? current.error ?? null : patch.error,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `UPDATE tasks SET
           status=@status, currentStep=@currentStep, videoTitle=@videoTitle,
           workDir=@workDir, article=@article, outputs=@outputs,
           error=@error, updatedAt=@updatedAt
         WHERE id=@id`,
      )
      .run({
        id,
        status: merged.status,
        currentStep: merged.currentStep,
        videoTitle: merged.videoTitle,
        workDir: merged.workDir,
        article: merged.article ? JSON.stringify(merged.article) : null,
        outputs: merged.outputs ? JSON.stringify(merged.outputs) : null,
        error: merged.error,
        updatedAt: merged.updatedAt,
      });
    return this.get(id)!;
  }

  /** 删除任务记录（不动 workDir 产物文件）。 */
  delete(id: string): void {
    this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  }

  close(): void {
    this.db.close();
  }
}
