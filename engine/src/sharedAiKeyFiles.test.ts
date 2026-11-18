// Key 文件加载 / 迁移 / 写入决策（shared/ai.ts 里的纯函数）。electron/src/main/aiKeys.ts 只按这些计划做 I/O。
import { describe, expect, it } from "vitest";
import {
	DEFAULT_AI_BASE_URL,
	decodeKeyFile,
	planKeyLoad,
	planKeySave,
	type KeyLoadInput,
	type KeyLoadPlan,
} from "@shared/ai";

const A = "https://a.com/v1";
const D = DEFAULT_AI_BASE_URL;

const base: KeyLoadInput = {
	encryptionAvailable: true,
	keyFile: "missing",
	legacyEnc: "missing",
	legacyTxt: "missing",
};
const plan = (over: Partial<KeyLoadInput>): KeyLoadPlan => planKeyLoad({ ...base, ...over });
const nothing = { save: false, deleteIfSaved: [], deleteNow: [], markKeyFileUnreadable: false };

describe("planKeyLoad", () => {
	it("全新安装：空表，不保存，不删任何文件", () => {
		expect(plan({})).toEqual({ table: {}, ...nothing });
		expect(plan({ encryptionAvailable: false })).toEqual({ table: {}, ...nothing });
	});

	it("ai-keys.enc 有效、无旧文件：原样返回，不保存", () => {
		expect(plan({ keyFile: { table: { [A]: "ka" } } })).toEqual({ table: { [A]: "ka" }, ...nothing });
	});

	it("只有旧 gemini-key.txt（加密可用）：并入默认地址，需保存，保存成功后删 txt", () => {
		expect(plan({ legacyTxt: { key: "old" } })).toEqual({
			table: { [D]: "old" },
			save: true,
			deleteIfSaved: ["gemini-key.txt"],
			deleteNow: [],
			markKeyFileUnreadable: false,
		});
	});

	it("只有旧 gemini-key.txt（加密不可用）：本次会话可用，但不保存、不删任何文件", () => {
		expect(plan({ encryptionAvailable: false, legacyTxt: { key: "old" } })).toEqual({
			table: { [D]: "old" },
			...nothing,
		});
	});

	it("只有旧 gemini-key.enc 且能解密：并入，需保存，保存成功后删 enc", () => {
		expect(plan({ legacyEnc: { key: "old" } })).toEqual({
			table: { [D]: "old" },
			save: true,
			deleteIfSaved: ["gemini-key.enc"],
			deleteNow: [],
			markKeyFileUnreadable: false,
		});
	});

	it("只有旧 gemini-key.enc 但无法解密：保留它，不保存，不删", () => {
		expect(plan({ legacyEnc: "unreadable" })).toEqual({ table: {}, ...nothing });
	});

	it("旧 enc 与 txt 都在：enc 的 Key 优先，两者都在保存成功后删", () => {
		expect(plan({ legacyEnc: { key: "from-enc" }, legacyTxt: { key: "from-txt" } })).toEqual({
			table: { [D]: "from-enc" },
			save: true,
			deleteIfSaved: ["gemini-key.enc", "gemini-key.txt"],
			deleteNow: [],
			markKeyFileUnreadable: false,
		});
	});

	it("旧 enc 解出空串 / 无法解密时退回 txt 的 Key；无法解密的 enc 不删", () => {
		expect(plan({ legacyEnc: { key: undefined }, legacyTxt: { key: "t" } })).toMatchObject({
			table: { [D]: "t" },
			save: true,
			deleteIfSaved: ["gemini-key.enc", "gemini-key.txt"],
		});
		expect(plan({ legacyEnc: "unreadable", legacyTxt: { key: "t" } })).toMatchObject({
			table: { [D]: "t" },
			save: true,
			deleteIfSaved: ["gemini-key.txt"],
		});
	});

	it("旧文件在、但从磁盘读出的表里默认地址已有 Key：不覆盖、不保存，直接删旧文件", () => {
		expect(plan({ keyFile: { table: { [D]: "new" } }, legacyEnc: { key: "old" }, legacyTxt: { key: "old" } })).toEqual({
			table: { [D]: "new" },
			save: false,
			deleteIfSaved: [],
			deleteNow: ["gemini-key.enc", "gemini-key.txt"],
			markKeyFileUnreadable: false,
		});
	});

	it("表读自磁盘时，空的或读不出的旧 txt 也直接删；无法解密的旧 enc 仍保留", () => {
		expect(plan({ keyFile: { table: { [A]: "ka" } }, legacyEnc: "unreadable", legacyTxt: { key: undefined } })).toEqual({
			table: { [A]: "ka" },
			save: false,
			deleteIfSaved: [],
			deleteNow: ["gemini-key.txt"],
			markKeyFileUnreadable: false,
		});
	});

	it("ai-keys.enc 无法读取 + 旧 txt：并入并需保存，并标记 ai-keys.enc 不可读（保存前先改名保留）", () => {
		expect(plan({ keyFile: "unreadable", legacyTxt: { key: "old" } })).toEqual({
			table: { [D]: "old" },
			save: true,
			deleteIfSaved: ["gemini-key.txt"],
			deleteNow: [],
			markKeyFileUnreadable: true,
		});
	});

	it("ai-keys.enc 无法读取、无旧文件：空表，不保存，但标记不可读", () => {
		expect(plan({ keyFile: "unreadable" })).toEqual({ table: {}, ...nothing, markKeyFileUnreadable: true });
	});

	it("加密不可用时已有 ai-keys.enc（未能读取）：不保存、不删，并标记不可读——以后保存先改名保留，不直接覆盖", () => {
		expect(plan({ encryptionAvailable: false, keyFile: "unreadable", legacyTxt: { key: "old" } })).toEqual({
			table: { [D]: "old" },
			save: false,
			deleteIfSaved: [],
			deleteNow: [],
			markKeyFileUnreadable: true,
		});
	});
});

describe("decodeKeyFile", () => {
	it("合法表 → { table }；字面量 {} → 空表", () => {
		expect(decodeKeyFile(JSON.stringify({ [A]: "ka" }))).toEqual({ table: { [A]: "ka" } });
		expect(decodeKeyFile(" {} ")).toEqual({ table: {} });
	});
	it("解出来不是合法表 → unreadable（别拿空表覆盖它）", () => {
		for (const text of ["", "not json", "[]", '{"http://evil.com/v1":"k"}', '{"x":1}']) {
			expect(decodeKeyFile(text)).toBe("unreadable");
		}
	});
});

describe("planKeySave", () => {
	it("加密不可用：不写", () => {
		expect(planKeySave({ encryptionAvailable: false, keyFileExists: true, keyFileUnreadable: true })).toEqual({
			write: false,
			renameAsideFirst: false,
		});
	});
	it("文件被标记不可读且仍存在：先改名保留再写", () => {
		expect(planKeySave({ encryptionAvailable: true, keyFileExists: true, keyFileUnreadable: true })).toEqual({
			write: true,
			renameAsideFirst: true,
		});
	});
	it("未标记、或文件已不存在：直接写", () => {
		expect(planKeySave({ encryptionAvailable: true, keyFileExists: true, keyFileUnreadable: false })).toEqual({
			write: true,
			renameAsideFirst: false,
		});
		expect(planKeySave({ encryptionAvailable: true, keyFileExists: false, keyFileUnreadable: true })).toEqual({
			write: true,
			renameAsideFirst: false,
		});
	});
});
