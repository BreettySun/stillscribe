/**
 * Gemini API Key 管理（仅打包后生效）。
 *
 * 【铁律 #6】Key 只在本地、绝不进 bundle/dmg/仓库。用 Electron safeStorage（macOS 钥匙串绑定本机本用户）
 * 加密存于 userData/gemini-key.enc。引擎保持 Electron-agnostic：主进程解密后经 env 注入
 * （STILLSCRIBE_GEMINI_API_KEY），与 STILLSCRIBE_YT_DLP 等注入同一套路。
 *
 * dev 下本模块直接返回 undefined：引擎由 `pnpm dev:engine`(tsx) 跑、自行 loadDotEnv() 读 engine/.env，
 * 不经此路径，避免 enc/.env 双源混淆、也不在 dev 产生 enc 文件。
 *
 * 首次配置（packaged）：把明文 Key 放进 userData/gemini-key.txt（或导出 env STILLSCRIBE_GEMINI_API_KEY），
 * 首启自动加密入 gemini-key.enc 并删除明文 txt。换 Key：删 enc、放新 txt、重启。
 */
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";

function keyEncPath(): string {
	return path.join(app.getPath("userData"), "gemini-key.enc");
}
function keyTxtPath(): string {
	return path.join(app.getPath("userData"), "gemini-key.txt");
}

/** 找一次性投放的明文种子：env > userData/gemini-key.txt。 */
function readSeed(): string | undefined {
	const fromEnv = process.env.STILLSCRIBE_GEMINI_API_KEY;
	if (fromEnv && fromEnv.trim()) return fromEnv.trim();
	const txt = keyTxtPath();
	if (existsSync(txt)) {
		const v = readFileSync(txt, "utf-8").trim();
		if (v) return v;
	}
	return undefined;
}

/**
 * 解析打包后引擎要用的 Gemini Key（须在 app ready 后调用——safeStorage 依赖之）。
 * 返回 undefined 时 auto 自动降级 semi（AI 集成文档 §6）。
 */
export function resolveGeminiKey(): string | undefined {
	if (!app.isPackaged) return undefined; // dev：引擎自读 engine/.env

	const enc = keyEncPath();
	const canEncrypt = safeStorage.isEncryptionAvailable();

	// 1) 已加密存储 → 解密。
	if (existsSync(enc)) {
		if (!canEncrypt) {
			console.error("[apiKey] 已有 gemini-key.enc 但 safeStorage 不可用，无法解密 → auto 将降级。");
			return undefined;
		}
		try {
			return safeStorage.decryptString(readFileSync(enc));
		} catch (err) {
			console.error(`[apiKey] 解密 gemini-key.enc 失败 → auto 将降级: ${String(err)}`);
			return undefined;
		}
	}

	// 2) 首次：找种子明文 → 加密落盘 + 删除明文 txt。
	const seed = readSeed();
	if (!seed) return undefined;
	if (!canEncrypt) {
		console.error("[apiKey] safeStorage 不可用，本次用明文种子但不持久化（建议检查系统钥匙串）。");
		return seed;
	}
	try {
		writeFileSync(enc, safeStorage.encryptString(seed));
		rmSync(keyTxtPath(), { force: true }); // 删除明文投放文件，仅保留加密形态
		console.error("[apiKey] 已将 Key 加密存入 gemini-key.enc 并删除明文 gemini-key.txt。");
	} catch (err) {
		console.error(`[apiKey] 持久化加密 Key 失败（本次仍用种子）: ${String(err)}`);
	}
	return seed;
}
