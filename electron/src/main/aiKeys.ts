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
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import { mergeLegacyKey, parseKeyTable, type AIKeyTable } from "@shared/ai";

const userData = (name: string): string => path.join(app.getPath("userData"), name);
const encPath = (): string => userData("ai-keys.enc");
const legacyEncPath = (): string => userData("gemini-key.enc");
const legacyTxtPath = (): string => userData("gemini-key.txt");

/**
 * 读旧版单 Key：gemini-key.enc（需解密）优先，其次明文 gemini-key.txt。
 * encKept=true 表示旧 enc 存在但无法解密——它是用户唯一的副本，清理时必须保留。
 */
function readLegacyKey(canDecrypt: boolean): { key: string | undefined; encKept: boolean } {
	let key: string | undefined;
	let encKept = false;
	if (existsSync(legacyEncPath())) {
		if (!canDecrypt) {
			encKept = true;
		} else {
			try {
				key = safeStorage.decryptString(readFileSync(legacyEncPath())).trim() || undefined;
			} catch {
				encKept = true;
				console.error("[aiKeys] 解密旧 gemini-key.enc 失败，已忽略并保留该文件。");
			}
		}
	}
	if (!key && existsSync(legacyTxtPath())) {
		try {
			key = readFileSync(legacyTxtPath(), "utf-8").trim() || undefined;
		} catch {
			console.error("[aiKeys] 读取旧 gemini-key.txt 失败，已忽略。");
		}
	}
	return { key, encKept };
}

/** 本次会话中 ai-keys.enc 存在但解密失败（可能是钥匙串授权被拒等暂时性原因）：不在加载时动它，首次写入前改名保留。 */
let encUnreadable = false;

/** 加密原子写盘（临时文件 + rename）；safeStorage 不可用时不写任何文件。返回是否已落盘。绝不抛出。 */
export function saveKeyTable(table: AIKeyTable): boolean {
	let tmp: string | undefined;
	try {
		if (!safeStorage.isEncryptionAvailable()) return false;
		const file = encPath();
		const bytes = safeStorage.encryptString(JSON.stringify(table));

		// 旧文件解密失败过：先改名保留（它可能是用户唯一的副本），改名失败则不写。
		if (encUnreadable && existsSync(file)) {
			try {
				renameSync(file, `${file}.unreadable-${Date.now()}`);
			} catch {
				console.error("[aiKeys] 无法保留无法解密的 ai-keys.enc，放弃写入。");
				return false;
			}
		}
		encUnreadable = false;

		tmp = `${file}.tmp-${process.pid}`;
		writeFileSync(tmp, bytes, { mode: 0o600 });
		chmodSync(tmp, 0o600); // mode 只在新建时生效，临时文件若已残留也要收紧
		renameSync(tmp, file);
		tmp = undefined;
		return true;
	} catch {
		console.error("[aiKeys] 写入 ai-keys.enc 失败。");
		return false;
	} finally {
		if (tmp) {
			try {
				rmSync(tmp, { force: true });
			} catch {
				/* 临时文件清理失败无碍 */
			}
		}
	}
}

/** 删除旧文件；失败只记固定一行，不抛出（否则会阻断应用启动）。 */
function removeLegacy(file: string): void {
	try {
		rmSync(file, { force: true });
	} catch {
		console.error("[aiKeys] 清理旧 gemini-key 文件失败，已忽略。");
	}
}

/**
 * 读取 Key 表，并把旧版 gemini-key 文件迁入。
 * 旧文件只在"返回的表已安全落在 ai-keys.enc"时清理（刚保存成功，或表本就读自成功解密的 ai-keys.enc）；
 * 其余情况（safeStorage 不可用、ai-keys.enc 缺失/解密失败且未保存成功）一律不删。
 * 无法解密的旧 gemini-key.enc 永远保留。
 */
export function loadKeyTable(): AIKeyTable {
	let canDecrypt = false;
	try {
		canDecrypt = safeStorage.isEncryptionAvailable();
	} catch {
		/* 视为不可用 */
	}
	let table: AIKeyTable = {};
	let loadedFromDisk = false;

	if (canDecrypt && existsSync(encPath())) {
		try {
			const text = safeStorage.decryptString(readFileSync(encPath()));
			table = parseKeyTable(text);
			// 解出来却不是合法表（parseKeyTable 对非法输入返回 {}）：同样视为不可读，别用空表覆盖。
			if (Object.keys(table).length === 0 && text.trim() !== "{}") {
				table = {};
				encUnreadable = true;
				console.error("[aiKeys] ai-keys.enc 内容无法解析，按空表处理并在改写前保留原文件。");
			} else {
				loadedFromDisk = true;
			}
		} catch {
			encUnreadable = true;
			console.error("[aiKeys] 解密 ai-keys.enc 失败，按空表处理（原文件保留，改写前会改名备份）。");
		}
	}

	const legacy = readLegacyKey(canDecrypt);
	const merged = mergeLegacyKey(table, legacy.key);
	let onDisk = loadedFromDisk;
	if (JSON.stringify(merged) !== JSON.stringify(table)) {
		table = merged;
		onDisk = saveKeyTable(table);
	}
	if (onDisk) {
		if (!legacy.encKept) removeLegacy(legacyEncPath());
		removeLegacy(legacyTxtPath());
	}
	return table;
}
