/**
 * 刷新 cookies.txt：从浏览器读取登录 cookie，**只保留 youtube.com 的**，落盘为 Netscape cookies.txt，
 * 供引擎/Electron 用 `--cookies <file>` 鉴权（避免 Electron 下读钥匙串失败）。
 *
 * 用法:
 *   pnpm refresh-cookies                       # 默认 chrome，写到 engine/work/cookies.txt
 *   pnpm refresh-cookies --browser safari
 *   pnpm refresh-cookies --url <youtube-url>   # 自定义触发用 URL
 *   DIGGO_WORK_ROOT=/path pnpm refresh-cookies  # 自定义工作根
 *
 * 原理：--cookies-from-browser 从浏览器读 cookie（需终端可访问钥匙串），先写出全量临时文件，
 *       再过滤成只含 youtube.com 的 cookie 写入最终文件（不把无关站点的 cookie 落盘）。
 */
import { mkdirSync } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolPath } from "../src/cli/tools.ts";
import { runCmd } from "../src/cli/shell.ts";

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const HTTPONLY = "#HttpOnly_";

/** 某行是不是 youtube.com 的 cookie（兼容 #HttpOnly_ 前缀）。 */
function isYouTubeCookie(line: string): boolean {
  const raw = line.startsWith(HTTPONLY) ? line.slice(HTTPONLY.length) : line;
  const domain = raw.split("\t")[0] ?? "";
  return domain.replace(/^\./, "").endsWith("youtube.com");
}

/** 保留 Netscape 头注释 + youtube.com 的 cookie（含 HttpOnly），丢弃其他站点。 */
function filterYouTube(text: string): { out: string; kept: number } {
  const lines: string[] = [];
  let kept = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    // 真注释/头（# 开头但不是 #HttpOnly_ 这种伪注释 cookie）原样保留。
    if (line.startsWith("#") && !line.startsWith(HTTPONLY)) {
      lines.push(line);
      continue;
    }
    if (isYouTubeCookie(line)) {
      lines.push(line);
      kept++;
    }
  }
  return { out: lines.join("\n") + "\n", kept };
}

async function main(): Promise<void> {
  const browser = flag("browser", process.env.DIGGO_BROWSER || "chrome");
  // 默认用 "Me at the zoo"（YouTube 第一条视频，极稳定）作触发；cookie 来自浏览器，与该视频无关。
  const url = flag("url", "https://www.youtube.com/watch?v=jNQXAC9IVRw");
  const workRoot = process.env.DIGGO_WORK_ROOT
    ? path.resolve(process.env.DIGGO_WORK_ROOT)
    : path.resolve("work");

  mkdirSync(workRoot, { recursive: true });
  const out = path.join(workRoot, "cookies.txt");
  const tmp = path.join(tmpdir(), `diggo-cookies-${process.pid}.txt`);

  console.error(`从 ${browser} 读取 cookie（仅保留 youtube.com）→ ${out}`);
  try {
    await runCmd(
      [
        toolPath("yt-dlp"),
        "--cookies-from-browser", browser,
        "--cookies", tmp,
        "--skip-download",
        "--print", "%(id)s",
        url,
      ],
      { timeoutMs: 120_000 },
    );
    const { out: filtered, kept } = filterYouTube(await readFile(tmp, "utf-8"));
    await writeFile(out, filtered, "utf-8");
    console.error(`✅ 已写入 ${kept} 条 youtube.com cookie: ${out}（引擎/App 经 DIGGO_COOKIES_FILE 自动使用）`);
  } finally {
    await rm(tmp, { force: true });
  }
}

main().catch((err: unknown) => {
  console.error(`\n❌ 刷新失败: ${err instanceof Error ? err.message : String(err)}`);
  console.error("提示：确认该浏览器已登录 YouTube，且在终端运行（Electron 子进程读不到钥匙串）。");
  process.exit(1);
});
