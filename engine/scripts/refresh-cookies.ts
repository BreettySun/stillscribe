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
import { resolveWorkRoot } from "../src/paths.ts";
import { refreshCookies } from "../src/modules/cookies-refresh.ts";

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function main(): Promise<void> {
  const browser = flag("browser", process.env.DIGGO_BROWSER || "chrome");
  const url = flag("url", "https://www.youtube.com/watch?v=jNQXAC9IVRw");
  const workRoot = resolveWorkRoot();

  console.error(`从 ${browser} 读取 cookie（仅保留 youtube.com）→ ${workRoot}/cookies.txt`);
  const { kept, out } = await refreshCookies({ workRoot, browser, url });
  console.error(`✅ 已写入 ${kept} 条 youtube.com cookie: ${out}（引擎按任务即时探测，无需重启 App 即生效）`);
}

main().catch((err: unknown) => {
  console.error(`\n❌ 刷新失败: ${err instanceof Error ? err.message : String(err)}`);
  console.error("提示：确认该浏览器已登录 YouTube，且在终端运行（Electron 子进程读不到钥匙串）。");
  process.exit(1);
});
