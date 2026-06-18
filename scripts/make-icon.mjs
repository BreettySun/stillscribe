/**
 * 生成 macOS App 图标：把源方图缩进到中央 + squircle 圆角 + 四周透明留白，
 * 直接产出 build/icon.png（1024）和 build/icon.icns（全尺寸）。
 *
 * 适用两类源图：① 铺满的方图；② Icon Composer 等导出的、已带圆角但顶满画布的全幅图——
 * 本脚本都会按 macOS Big Sur 网格补上规范留白，避免在 Dock 里顶到边显得过大。
 *
 * 用法：node scripts/make-icon.mjs [源图=build/icon-source.png]
 * sharp 复用 engine 的依赖（打包工具链，不进引擎运行时，符合 CLAUDE.md 铁律 #2）。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO_ROOT, "engine/package.json"));
const sharp = require("sharp");

const SRC = path.resolve(REPO_ROOT, process.argv[2] ?? "build/icon-source.png");
const BUILD = path.join(REPO_ROOT, "build");
const PNG = path.join(BUILD, "icon.png");
const ICNS = path.join(BUILD, "icon.icns");

// macOS Big Sur 图标网格：1024 画布里圆角矩形约 824×824，圆角半径 ≈ 22.37%。
const CANVAS = 1024;
const TILE = 824;
const RADIUS = Math.round(TILE * 0.2237); // ≈ 184
const MARGIN = Math.round((CANVAS - TILE) / 2); // 100

const mask = Buffer.from(
	`<svg width="${TILE}" height="${TILE}" xmlns="http://www.w3.org/2000/svg">
		<rect width="${TILE}" height="${TILE}" rx="${RADIUS}" ry="${RADIUS}"/>
	</svg>`,
);

mkdirSync(BUILD, { recursive: true });

const tile = await sharp(SRC)
	.resize(TILE, TILE, { fit: "cover" })
	.composite([{ input: mask, blend: "dest-in" }]) // 圆角矩形裁出 alpha
	.png()
	.toBuffer();

await sharp({
	create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
	.composite([{ input: tile, top: MARGIN, left: MARGIN }])
	.png()
	.toFile(PNG);

// 用系统 sips/iconutil 生成 .icns（无第三方依赖）。
const iconset = mkdtempSync(path.join(tmpdir(), "diggo-iconset-"));
const sizes = [
	["icon_16x16", 16], ["icon_16x16@2x", 32],
	["icon_32x32", 32], ["icon_32x32@2x", 64],
	["icon_128x128", 128], ["icon_128x128@2x", 256],
	["icon_256x256", 256], ["icon_256x256@2x", 512],
	["icon_512x512", 512], ["icon_512x512@2x", 1024],
];
try {
	for (const [name, px] of sizes) {
		execFileSync("sips", ["-z", String(px), String(px), PNG, "--out", path.join(iconset, `${name}.png`)], { stdio: "ignore" });
	}
	// iconutil 要求目录名以 .iconset 结尾。
	const iconsetDir = `${iconset}.iconset`;
	execFileSync("mv", [iconset, iconsetDir]);
	execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", ICNS]);
	rmSync(iconsetDir, { recursive: true, force: true });
} finally {
	rmSync(iconset, { recursive: true, force: true });
}

console.log(`✓ build/icon.png  (${CANVAS}px, tile ${TILE}, r=${RADIUS}, margin ${MARGIN})`);
console.log(`✓ build/icon.icns`);
