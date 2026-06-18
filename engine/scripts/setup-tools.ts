/**
 * 构建期工具：下载自包含的外部 CLI 二进制到仓库根 `bin/`，让引擎脱离 Homebrew 可跑。
 *   pnpm setup-tools
 *
 * - macOS arm64 静态构建（ffmpeg/ffprobe 仅依赖系统框架，无 Homebrew dylib）。
 * - 每个产物 pin URL + sha256，校验失败即退出。
 * - 幂等：bin/<tool> 已存在则跳过（删掉重跑即可更新）。
 * - 出站仅构建期（osxexperts / github releases），不发任何密钥；运行时出站不涉及（铁律 #6）。
 */
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
	copyFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface ToolSpec {
	name: string;
	url: string;
	sha256: string; // 下载产物（zip 或裸二进制）的哈希
	/** zip 内要取出的二进制名；省略表示 url 本身就是裸二进制。 */
	zipEntry?: string;
}

const TOOLS: ToolSpec[] = [
	{
		name: "ffmpeg",
		url: "https://www.osxexperts.net/ffmpeg81arm.zip",
		sha256: "ebb82529562b71170807bbc6b0e7eb4f0b13af8cbb0e085bb9e8f6fe709598ad",
		zipEntry: "ffmpeg",
	},
	{
		name: "ffprobe",
		url: "https://www.osxexperts.net/ffprobe81arm.zip",
		sha256: "a6640a77d38a6f0527c5b597e599cb36a3427a6931444ed80bc62542421950a1",
		zipEntry: "ffprobe",
	},
	{
		name: "yt-dlp",
		url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.06.09/yt-dlp_macos",
		sha256: "b82c3626952e6c14eaf654cc565866775ffd0b9ffb7021628ac59b42c2f4f244",
	},
	{
		// deno：yt-dlp 解 YouTube nsig 的 JS 运行时（缺它只剩图片格式，无法下载视频）。
		// 打包后 PATH 被精简，yt-dlp 找不到 PATH 里的 deno，故必须内置并 --js-runtimes 显式指路。
		name: "deno",
		url: "https://github.com/denoland/deno/releases/download/v2.8.3/deno-aarch64-apple-darwin.zip",
		sha256: "88b350be928fdba0e5d8142ff7c101a17133426371e3cf5ed0e0f74e62476f6c",
		zipEntry: "deno",
	},
];

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BIN_DIR = path.resolve(SCRIPT_DIR, "../../bin"); // 仓库根 /bin

function sha256(buf: Buffer): string {
	return createHash("sha256").update(buf).digest("hex");
}

async function fetchBuffer(url: string): Promise<Buffer> {
	const res = await fetch(url, { redirect: "follow" });
	if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
	return Buffer.from(await res.arrayBuffer());
}

function unzipEntry(zipPath: string, entry: string, destDir: string): string {
	// 用系统 unzip（构建期工具，macOS 自带）；-j 去目录、-o 覆盖。
	const r = spawnSync(
		"/usr/bin/unzip",
		["-o", "-j", zipPath, entry, "-d", destDir],
		{
			encoding: "utf-8",
		},
	);
	if (r.status !== 0) throw new Error(`解压失败: ${entry}\n${r.stderr}`);
	const out = path.join(destDir, path.basename(entry));
	if (!existsSync(out)) throw new Error(`zip 内未找到条目: ${entry}`);
	return out;
}

async function installTool(spec: ToolSpec): Promise<void> {
	const target = path.join(BIN_DIR, spec.name);
	if (existsSync(target)) {
		console.log(`✓ ${spec.name} 已存在，跳过（删除 ${target} 可重装）`);
		return;
	}
	console.log(`↓ 下载 ${spec.name}: ${spec.url}`);
	const buf = await fetchBuffer(spec.url);
	const got = sha256(buf);
	if (got !== spec.sha256) {
		throw new Error(
			`${spec.name} sha256 不匹配:\n  期望 ${spec.sha256}\n  实际 ${got}`,
		);
	}

	if (spec.zipEntry) {
		const tmpZip = path.join(BIN_DIR, `.${spec.name}.zip`);
		writeFileSync(tmpZip, buf);
		const extracted = unzipEntry(tmpZip, spec.zipEntry, BIN_DIR);
		if (extracted !== target) {
			copyFileSync(extracted, target);
			rmSync(extracted);
		}
		rmSync(tmpZip);
	} else {
		writeFileSync(target, buf);
	}
	chmodSync(target, 0o755);
	console.log(`✓ ${spec.name} → ${target}`);
}

function selfCheck(): void {
	const ffmpeg = path.join(BIN_DIR, "ffmpeg");
	const enc = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], {
		encoding: "utf-8",
	});
	if (enc.status !== 0 || !/libwebp\b/.test(enc.stdout)) {
		throw new Error(
			"自检失败：bin/ffmpeg 缺少 libwebp 编码器（M3 webp 依赖）。",
		);
	}
	console.log("✓ 自检：ffmpeg 含 libwebp 编码器");
}

async function main(): Promise<void> {
	mkdirSync(BIN_DIR, { recursive: true });
	for (const spec of TOOLS) await installTool(spec);
	selfCheck();
	console.log(`\n✅ 工具就位于 ${BIN_DIR}（引擎已可脱离 Homebrew 运行）。`);
}

main().catch((e: unknown) => {
	console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`);
	process.exit(1);
});
