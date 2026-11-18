/**
 * 刷新 cookies.txt 的公共核心：从浏览器读登录 cookie，**只保留 youtube.com**，
 * 落盘为 Netscape cookies.txt，供引擎/Electron 用 `--cookies <file>` 鉴权。
 *
 * CLI 入口（scripts/refresh-cookies.ts）与 HTTP 端点（server.ts POST /cookies/refresh）共用本函数。
 * 注意：--cookies-from-browser 需进程可访问浏览器钥匙串（终端/Electron 主进程可，引擎子进程常失败）。
 */
import { mkdirSync } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolPath, jsRuntimeArgs } from "../cli/tools.ts";
import { runCmd } from "../cli/shell.ts";
import { cookiesPath } from "../paths.ts";
import { filterYouTube } from "./cookies-filter.ts";

export interface RefreshCookiesOptions {
  workRoot: string;
  browser: string;
  /** 触发用 URL；默认 "Me at the zoo"（YouTube 第一条视频，极稳定）。cookie 来自浏览器，与该视频无关。 */
  url?: string;
  timeoutMs?: number;
}

/** 从浏览器导出 youtube.com cookie 到 <workRoot>/cookies.txt，返回写入条数。 */
export async function refreshCookies(opts: RefreshCookiesOptions): Promise<{ kept: number; out: string }> {
  const url = opts.url ?? "https://www.youtube.com/watch?v=jNQXAC9IVRw";
  mkdirSync(opts.workRoot, { recursive: true });
  const out = cookiesPath(opts.workRoot);
  const tmp = path.join(tmpdir(), `stillscribe-cookies-${process.pid}-${Date.now()}.txt`);

  try {
    await runCmd(
      [
        toolPath("yt-dlp"),
        ...jsRuntimeArgs(),
        "--cookies-from-browser", opts.browser,
        "--cookies", tmp,
        "--skip-download",
        "--print", "%(id)s",
        url,
      ],
      { timeoutMs: opts.timeoutMs ?? 120_000 },
    );
    const { out: filtered, kept } = filterYouTube(await readFile(tmp, "utf-8"));
    await writeFile(out, filtered, "utf-8");
    return { kept, out };
  } finally {
    await rm(tmp, { force: true });
  }
}
