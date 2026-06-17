/**
 * 目录结构与 HH_MM_SS 命名约定 —— 全项目唯一定义处（架构文档第 7 节、CLAUDE.md §4.2/§5）。
 * 禁止在各处硬编码路径字符串拼接，一律走这里。
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Timestamp } from "@shared/types";

const NAME_RE = /^(\d{2})_(\d{2})_(\d{2})$/;
const HTTPONLY = "#HttpOnly_";

/** 工作根目录解析 —— 全项目唯一定义（DIGGO_WORK_ROOT，默认 ./work）。 */
export function resolveWorkRoot(env = process.env.DIGGO_WORK_ROOT): string {
  return env ? path.resolve(env) : path.resolve("work");
}

/** 工作根下的 cookies.txt 约定路径（refresh-cookies 落盘点 / yt-dlp --cookies 读取点）。 */
export function cookiesPath(workRoot: string): string {
  return path.join(workRoot, "cookies.txt");
}

/**
 * 解析本任务实际可用的 cookies.txt（P1 方案 A：按任务即时探测，跑完 refresh-cookies 无需重启引擎即生效）。
 * 来源优先级：DIGGO_COOKIES_FILE 显式覆盖 > <workRoot>/cookies.txt。
 * 仅当文件存在且含至少一条 cookie 行时返回路径；否则返回 undefined，调用方回退 --cookies-from-browser。
 * （文件被置空/只剩注释头时视为无效 → 自动回退浏览器，而非静默撞 bot 验证。）
 */
export function resolveCookiesFile(workRoot: string): string | undefined {
  const file = process.env.DIGGO_COOKIES_FILE
    ? path.resolve(process.env.DIGGO_COOKIES_FILE)
    : cookiesPath(workRoot);
  if (!existsSync(file)) return undefined;
  const hasCookie = readFileSync(file, "utf-8")
    .split("\n")
    .some((line) => {
      const t = line.trim();
      if (t === "") return false;
      // #HttpOnly_ 是伪注释 cookie（真 cookie）；其余 # 开头是注释头。
      return !t.startsWith("#") || t.startsWith(HTTPONLY);
    });
  return hasCookie ? file : undefined;
}

/** 秒数 → "HH_MM_SS"（fps=1 下帧序号即秒数，纯算术映射）。 */
export function secondsToName(seconds: number): Timestamp {
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new Error(`秒数必须为非负整数: ${seconds}`);
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}_${pad(m)}_${pad(s)}`;
}

/** "HH_MM_SS" → 秒数。非法名称抛错。 */
export function nameToSeconds(name: string): number {
  const m = NAME_RE.exec(name);
  if (!m) throw new Error(`不是合法的 HH_MM_SS 名称: ${JSON.stringify(name)}`);
  const [, h, mi, s] = m;
  return Number(h) * 3600 + Number(mi) * 60 + Number(s);
}

/** 视频标题 → 安全目录名片段（保留中文与字母数字，其余转下划线）。 */
export function slugifyTitle(title: string, maxLen = 50): string {
  const slug = title
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return slug.slice(0, maxLen).replace(/_+$/g, "");
}

/**
 * 任务工作目录。结构见 CLAUDE.md §4.2：
 *   <root>/source 01_hd 02_webp 03_grids article mp4_clips + task.json
 */
export class TaskDir {
  constructor(readonly root: string) {}

  /** 在工作根目录下创建 `<videoId_slug>/` 及全部子目录（幂等）。 */
  static create(workRoot: string, videoId: string, title: string): TaskDir {
    const td = new TaskDir(path.join(workRoot, `${videoId}_${slugifyTitle(title)}`));
    for (const d of [td.source, td.hd, td.webp, td.grids, td.articleDir, td.clips]) {
      mkdirSync(d, { recursive: true });
    }
    return td;
  }

  get source(): string { return path.join(this.root, "source"); }
  get hd(): string { return path.join(this.root, "01_hd"); }
  get webp(): string { return path.join(this.root, "02_webp"); }
  get grids(): string { return path.join(this.root, "03_grids"); }
  get articleDir(): string { return path.join(this.root, "article"); }
  get clips(): string { return path.join(this.root, "mp4_clips"); }

  get taskJson(): string { return path.join(this.root, "task.json"); }
  get representativesJson(): string { return path.join(this.root, "representatives.json"); }
  get articleJson(): string { return path.join(this.articleDir, "article.json"); }
  get promptTxt(): string { return path.join(this.articleDir, "prompt.txt"); }
  get docx(): string { return path.join(this.articleDir, "article_final.docx"); }
}
