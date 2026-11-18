/**
 * 模型服务 Key 表的持久化（按规范化 Base URL 存）。
 *
 * 【铁律 #6】Key 只在本地：用 Electron safeStorage（macOS 钥匙串绑定本机本用户）加密后存于
 * userData/ai-keys.enc，内容是 AIKeyTable 的 JSON。引擎保持 Electron-agnostic：启动时经
 * STILLSCRIBE_AI_KEYS 注入，运行期经 PUT /settings/ai/key 更新。
 *
 * 任何 Key 或解密内容都不得写入 stdout/stderr（含错误路径）。须在 app ready 之后调用（safeStorage 依赖之）。
 * 开发态与打包后行为一致。
 *
 * 本文件只做 I/O：读文件 / 解密得到输入，调 shared/ai.ts 的纯函数（planKeyLoad / decodeKeyFile / planKeySave）
 * 拿到计划，再执行计划里的写入、改名、删除。删哪个、改名哪个、要不要写，全部由纯函数决定（有单测）。
 */
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import {
	decodeKeyFile,
	planKeyLoad,
	planKeySave,
	type AIKeyTable,
	type KeyFileState,
	type LegacyEncState,
	type LegacyKeyFile,
	type LegacyTxtState,
} from "@shared/ai";

const userData = (name: string): string => path.join(app.getPath("userData"), name);
const encPath = (): string => userData("ai-keys.enc");

/** 本次会话中 ai-keys.enc 存在但未能读取（解密失败、内容非法、或加载时加密不可用）：首次写入前改名保留。 */
let encUnreadable = false;

function encryptionAvailable(): boolean {
	try {
		return safeStorage.isEncryptionAvailable();
	} catch {
		return false;
	}
}

/** 读 ai-keys.enc。加密不可用时不尝试解密，报告为 unreadable。 */
function readKeyFile(canDecrypt: boolean): KeyFileState {
	if (!existsSync(encPath())) return "missing";
	if (!canDecrypt) return "unreadable";
	let text: string;
	try {
		text = safeStorage.decryptString(readFileSync(encPath()));
	} catch {
		console.error("[aiKeys] 解密 ai-keys.enc 失败，按空表处理（原文件保留，改写前会改名备份）。");
		return "unreadable";
	}
	const state = decodeKeyFile(text);
	if (state === "unreadable") {
		console.error("[aiKeys] ai-keys.enc 内容无法解析，按空表处理并在改写前保留原文件。");
	}
	return state;
}

/** 读旧版 gemini-key.enc。加密不可用时不尝试解密，报告为 unreadable。 */
function readLegacyEnc(canDecrypt: boolean): LegacyEncState {
	const file = userData("gemini-key.enc");
	if (!existsSync(file)) return "missing";
	if (!canDecrypt) return "unreadable";
	try {
		return { key: safeStorage.decryptString(readFileSync(file)).trim() || undefined };
	} catch {
		console.error("[aiKeys] 解密旧 gemini-key.enc 失败，已忽略并保留该文件。");
		return "unreadable";
	}
}

/** 读旧版明文 gemini-key.txt；读取失败按空 Key 处理。 */
function readLegacyTxt(): LegacyTxtState {
	const file = userData("gemini-key.txt");
	if (!existsSync(file)) return "missing";
	try {
		return { key: readFileSync(file, "utf-8").trim() || undefined };
	} catch {
		console.error("[aiKeys] 读取旧 gemini-key.txt 失败，已忽略。");
		return { key: undefined };
	}
}

/** 加密原子写盘（临时文件 + rename）；safeStorage 不可用时不写任何文件。返回是否已落盘。绝不抛出。 */
export function saveKeyTable(table: AIKeyTable): boolean {
	let tmp: string | undefined;
	try {
		const file = encPath();
		const plan = planKeySave({
			encryptionAvailable: safeStorage.isEncryptionAvailable(),
			keyFileExists: existsSync(file),
			keyFileUnreadable: encUnreadable,
		});
		if (!plan.write) return false;
		const bytes = safeStorage.encryptString(JSON.stringify(table));

		if (plan.renameAsideFirst) {
			try {
				renameSync(file, `${file}.unreadable-${Date.now()}`);
			} catch {
				console.error("[aiKeys] 无法保留无法读取的 ai-keys.enc，放弃写入。");
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
function removeLegacy(files: readonly LegacyKeyFile[]): void {
	for (const name of files) {
		try {
			rmSync(userData(name), { force: true });
		} catch {
			console.error("[aiKeys] 清理旧 gemini-key 文件失败，已忽略。");
		}
	}
}

/** 读取 Key 表，并按 planKeyLoad 的计划迁入旧版 gemini-key 文件（读 / 写 / 删各自吞掉错误，不阻断启动）。 */
export function loadKeyTable(): AIKeyTable {
	const canDecrypt = encryptionAvailable();
	const plan = planKeyLoad({
		encryptionAvailable: canDecrypt,
		keyFile: readKeyFile(canDecrypt),
		legacyEnc: readLegacyEnc(canDecrypt),
		legacyTxt: readLegacyTxt(),
	});
	if (plan.markKeyFileUnreadable) encUnreadable = true;
	removeLegacy(plan.deleteNow);
	if (plan.save && saveKeyTable(plan.table)) removeLegacy(plan.deleteIfSaved);
	return plan.table;
}
