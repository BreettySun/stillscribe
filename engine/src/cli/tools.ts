/**
 * 外部 CLI 工具的绝对路径解析。统一从这里取，禁止依赖 PATH。
 * （CLAUDE.md 铁律 #1：打包后 Finder 启动只有精简 PATH，依赖 PATH 必然失效。）
 *
 * 解析优先级：
 *   1. 环境变量 STILLSCRIBE_<TOOL大写>（如 STILLSCRIBE_FFMPEG=/path/to/ffmpeg）
 *   2. 仓库 `bin/<tool>`（自包含主路径，经 `pnpm setup-tools` 下载，脱离 Homebrew）
 *   3. DEFAULT_TOOLS（Homebrew 开发回退）
 *   找不到则抛出带提示的错误。
 *
 * 拼宫格图已改用 ffmpeg 的 tile 滤镜（见 m6-grids.ts），不再依赖 ImageMagick。
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ToolName = "ffmpeg" | "ffprobe" | "yt-dlp" | "deno";

/** 仓库根 `bin/`：从 engine/src/cli/ 上溯三级到仓库根。 */
const BIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../bin");

/**
 * Homebrew 开发回退路径（本机实测，2026-06）。
 * ffmpeg 用 ffmpeg-full：brew 精简版不带 libwebp，而 M3 webp 全集依赖它。
 * 优先用 `pnpm setup-tools` 装到 bin/ 的自包含静态版，这些仅作回退。
 */
const DEFAULT_TOOLS: Record<ToolName, string> = {
  ffmpeg: "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
  ffprobe: "/opt/homebrew/opt/ffmpeg-full/bin/ffprobe",
  "yt-dlp": "/opt/homebrew/bin/yt-dlp",
  // deno：yt-dlp 解 YouTube nsig 的 JS 运行时（2025+ 起 yt-dlp 默认只认 deno，缺它只剩图片格式）。
  deno: "/opt/homebrew/bin/deno",
};

function envKey(name: ToolName): string {
  return "STILLSCRIBE_" + name.toUpperCase().replace(/-/g, "_");
}

function isFile(p: string): boolean {
  return existsSync(p) && statSync(p).isFile();
}

/**
 * 解析工具的绝对路径。
 *
 * P4 打包注意：届时在此函数顶部加分支——
 *   if (process.resourcesPath) return path.join(process.resourcesPath, "bin", name);
 * extraResources 内置的 bin/ 与本函数同款布局，仍是绝对路径。
 */
export function toolPath(name: ToolName): string {
  const resolved = optionalToolPath(name);
  if (resolved) return resolved;
  throw new Error(
    `找不到 ${name}。请运行 \`pnpm setup-tools\` 下载内置二进制到 bin/，\n` +
      `或用环境变量 ${envKey(name)} 指定其绝对路径（禁止依赖 PATH）。`,
  );
}

/** 同 toolPath，但找不到时返回 undefined 而非抛错（用于可选工具，如 deno）。 */
export function optionalToolPath(name: ToolName): string | undefined {
  const fromEnv = process.env[envKey(name)];
  if (fromEnv) {
    if (isFile(fromEnv)) return fromEnv;
    throw new Error(`${envKey(name)} 指向的文件不存在: ${fromEnv}`);
  }
  const vendored = path.join(BIN_DIR, name);
  if (isFile(vendored)) return vendored;
  if (isFile(DEFAULT_TOOLS[name])) return DEFAULT_TOOLS[name];
  return undefined;
}

/**
 * yt-dlp 解 YouTube nsig 需要 JS 运行时（默认只认 deno）。返回应插入 yt-dlp 命令的
 * `--js-runtimes deno:<绝对路径>` 参数；deno 不可用时返回 []（降级——可能缺视频格式）。
 * 打包态 PATH 被精简，yt-dlp 无法自行在 PATH 找到 deno，故必须显式传绝对路径（铁律 #1）。
 */
export function jsRuntimeArgs(): string[] {
  const deno = optionalToolPath("deno");
  return deno ? ["--js-runtimes", `deno:${deno}`] : [];
}
