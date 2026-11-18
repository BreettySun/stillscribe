/**
 * 模型服务 Key 表的持久化（按规范化 Base URL 存）。
 *
 * 【铁律 #6】Key 只在本地：用 Electron safeStorage（macOS 钥匙串绑定本机本用户）加密后存于
 * userData/ai-keys.enc，内容是 AIKeyTable 的 JSON。引擎保持 Electron-agnostic：启动时经
 * STILLSCRIBE_AI_KEYS 注入，运行期经 PUT /settings/ai/key 更新。
 *
 * 任何 Key 或解密内容都不得写入 stdout/stderr（含错误路径）。须在 app ready 之后调用（safeStorage 依赖之）。
 * 开发态与打包后行为一致。
 */
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import { mergeLegacyKey, parseKeyTable, type AIKeyTable } from "@shared/ai";

const userData = (name: string): string => path.join(app.getPath("userData"), name);
const encPath = (): string => userData("ai-keys.enc");
const legacyEncPath = (): string => userData("gemini-key.enc");
const legacyTxtPath = (): string => userData("gemini-key.txt");

/** 读旧版单 Key：gemini-key.enc（需解密）优先，其次明文 gemini-key.txt。 */
function readLegacyKey(canDecrypt: boolean): string | undefined {
	if (canDecrypt && existsSync(legacyEncPath())) {
		try {
			const v = safeStorage.decryptString(readFileSync(legacyEncPath())).trim();
			if (v) return v;
		} catch {
			console.error("[aiKeys] 解密旧 gemini-key.enc 失败，已忽略。");
		}
	}
	if (existsSync(legacyTxtPath())) {
		try {
			const v = readFileSync(legacyTxtPath(), "utf-8").trim();
			if (v) return v;
		} catch {
			console.error("[aiKeys] 读取旧 gemini-key.txt 失败，已忽略。");
		}
	}
	return undefined;
}

/** 加密写盘；safeStorage 不可用时不写任何文件。返回是否已落盘。 */
export function saveKeyTable(table: AIKeyTable): boolean {
	if (!safeStorage.isEncryptionAvailable()) return false;
	try {
		const file = encPath();
		writeFileSync(file, safeStorage.encryptString(JSON.stringify(table)), { mode: 0o600 });
		chmodSync(file, 0o600); // mode 只在新建时生效，已存在的文件也要收紧
		return true;
	} catch {
		console.error("[aiKeys] 写入 ai-keys.enc 失败。");
		return false;
	}
}

/** 读取 Key 表，并把旧版 gemini-key 文件迁入（仅在新文件落盘成功后才删旧文件）。 */
export function loadKeyTable(): AIKeyTable {
	const canDecrypt = safeStorage.isEncryptionAvailable();
	let table: AIKeyTable = {};

	if (canDecrypt && existsSync(encPath())) {
		try {
			table = parseKeyTable(safeStorage.decryptString(readFileSync(encPath())));
		} catch {
			console.error("[aiKeys] 解密 ai-keys.enc 失败，按空表处理。");
		}
	}

	const merged = mergeLegacyKey(table, readLegacyKey(canDecrypt));
	if (JSON.stringify(merged) !== JSON.stringify(table)) {
		table = merged;
		if (saveKeyTable(table)) {
			rmSync(legacyEncPath(), { force: true });
			rmSync(legacyTxtPath(), { force: true });
		}
	}
	return table;
}
