/**
 * UI 偏好设置存储：better-sqlite3 单文件键值库（铁律 #9 —— 状态归引擎 + SQLite，不用浏览器存储）。
 * 通用 string KV；类型化/校验交给 server 层（按 shared/types 的 UISettings 契约）。
 *
 * 注：better-sqlite3 是原生模块；打包需 electron-rebuild 编译（CLAUDE.md §8）。
 */
import Database from "better-sqlite3";

export class SettingsStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  get(key: string): string | undefined {
    const row = this.db.prepare(`SELECT value FROM kv_settings WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO kv_settings (key, value) VALUES (@key, @value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run({ key, value });
  }

  close(): void {
    this.db.close();
  }
}
