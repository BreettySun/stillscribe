import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Article } from "@shared/types";
import { buildExportDoc, copyExportImages, slugify } from "./m8-layout.ts";
import { escapeMarkdown, renderMarkdown } from "./m8-markdown.ts";
import { escapeHtml, renderHtml } from "./m8-html.ts";

const ARTICLE: Article = {
	pages: [
		{ subhead: "Intro", image: "00_00_05", body: "Meet the house.\n\nIt is huge." },
		{ subhead: "1. Grand Entrance", image: "00_01_32", body: "A tall door." },
		{ subhead: "2. Café & Bar", image: "00_02_10", body: "Drinks *all* day." },
	],
	meta: {
		titles: ["Inside a $50M Home", "A Tour You Won't Forget", "Luxury, Redefined"],
		keywords: ["luxury home", "tour"],
		description: 'A "wild" tour.',
	},
	notes: { frameworkRationale: "中文框架说明", imageRationale: "中文选图理由" },
};

describe("slugify", () => {
	it("去编号、去重音、小写、连字符", () => {
		expect(slugify("1. Grand Entrance")).toBe("grand-entrance");
		expect(slugify("2. Café & Bar")).toBe("cafe-bar");
		expect(slugify("Intro")).toBe("intro");
		expect(slugify("13. Architect's Deep Connection")).toBe("architects-deep-connection");
	});

	it("纯非拉丁文本得到空串", () => {
		expect(slugify("3. 宏伟的入口")).toBe("");
	});
});

describe("buildExportDoc", () => {
	const doc = buildExportDoc(ARTICLE, { sourceUrl: "https://youtu.be/x" });

	it("首个候选标题为主标题，其余进 altTitles", () => {
		expect(doc.title).toBe("Inside a $50M Home");
		expect(doc.altTitles).toEqual(["A Tour You Won't Forget", "Luxury, Redefined"]);
		expect(doc.sourceUrl).toBe("https://youtu.be/x");
	});

	it("引言无小标题；其后各节保留带编号的小标题", () => {
		expect(doc.sections.map((s) => s.heading)).toEqual([
			undefined,
			"1. Grand Entrance",
			"2. Café & Bar",
		]);
		expect(doc.sections[0]!.paragraphs).toEqual(["Meet the house.", "It is huge."]);
	});

	it("配图文件名 = 两位页序号 + 小标题 slug；alt 去编号，引言用主标题", () => {
		expect(doc.sections.map((s) => s.image.fileName)).toEqual([
			"00-intro.jpg",
			"01-grand-entrance.jpg",
			"02-cafe-bar.jpg",
		]);
		expect(doc.sections.map((s) => s.image.alt)).toEqual([
			"Inside a $50M Home",
			"Grand Entrance",
			"Café & Bar",
		]);
	});

	it("slug 为空时文件名退回时间戳", () => {
		const d = buildExportDoc({
			...ARTICLE,
			pages: [ARTICLE.pages[0]!, { subhead: "1. 宏伟的入口", image: "00_03_00", body: "b" }],
		});
		expect(d.sections[1]!.image.fileName).toBe("01-00_03_00.jpg");
	});

	it("无候选标题时用 fallbackTitle", () => {
		const d = buildExportDoc(
			{ ...ARTICLE, meta: { ...ARTICLE.meta, titles: [] } },
			{ fallbackTitle: "Video Title" },
		);
		expect(d.title).toBe("Video Title");
		expect(d.altTitles).toEqual([]);
	});
});

describe("escapeMarkdown", () => {
	it("转义行内标记字符", () => {
		expect(escapeMarkdown("a *b* _c_ [d] <e> `f`")).toBe("a \\*b\\* \\_c\\_ \\[d\\] \\<e\\> \\`f\\`");
	});

	it("转义行首块级标记，行中的不动", () => {
		expect(escapeMarkdown("# not a heading")).toBe("\\# not a heading");
		expect(escapeMarkdown("- not a list")).toBe("\\- not a list");
		expect(escapeMarkdown("1. not a list")).toBe("1\\. not a list");
		expect(escapeMarkdown("---")).toBe("\\---");
		expect(escapeMarkdown("No. 1 - best #1")).toBe("No. 1 - best #1");
	});

	it("转义 HTML 实体写法，普通 & 不动", () => {
		expect(escapeMarkdown("AT&T &copy; 2026")).toBe("AT&T \\&copy; 2026");
	});
});

describe("renderMarkdown", () => {
	const md = renderMarkdown(buildExportDoc(ARTICLE, { sourceUrl: "https://youtu.be/x" }));

	it("front matter 含标题、description、关键词、候选标题、来源", () => {
		expect(md.startsWith("---\n")).toBe(true);
		expect(md).toContain('title: "Inside a $50M Home"');
		expect(md).toContain('description: "A \\"wild\\" tour."');
		expect(md).toContain('keywords: ["luxury home", "tour"]');
		expect(md).toContain('alt_titles: ["A Tour You Won\'t Forget", "Luxury, Redefined"]');
		expect(md).toContain('source: "https://youtu.be/x"');
	});

	it("引言无标题；各节 ## 小标题 → 配图（相对路径）→ 正文", () => {
		expect(md).not.toMatch(/^# /m);
		expect(md).toContain("![Inside a $50M Home](images/00-intro.jpg)\n\nMeet the house.\n\nIt is huge.");
		expect(md).toContain("## 1. Grand Entrance\n\n![Grand Entrance](images/01-grand-entrance.jpg)\n\nA tall door.");
		expect(md).toContain("Drinks \\*all\\* day.");
	});

	it("notes 绝不进 Markdown（铁律 #4）", () => {
		expect(md).not.toContain("中文");
	});

	it("缺图则跳过该图，其余照常", () => {
		const out = renderMarkdown(buildExportDoc(ARTICLE), {
			missing: new Set(["01-grand-entrance.jpg"]),
		});
		expect(out).not.toContain("01-grand-entrance.jpg");
		expect(out).toContain("## 1. Grand Entrance\n\nA tall door.");
		expect(out).toContain("images/02-cafe-bar.jpg");
	});
});

describe("renderHtml", () => {
	const html = renderHtml(buildExportDoc(ARTICLE, { sourceUrl: "https://youtu.be/x" }));

	it("escapeHtml 转义五个特殊字符", () => {
		expect(escapeHtml(`<a href="x">T&C's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;T&amp;C&#39;s&lt;/a&gt;");
	});

	it("head 含 title / description / keywords / 候选标题 / 来源", () => {
		expect(html.startsWith("<!doctype html>")).toBe(true);
		expect(html).toContain("<title>Inside a $50M Home</title>");
		expect(html).toContain('<meta name="description" content="A &quot;wild&quot; tour.">');
		expect(html).toContain('<meta name="keywords" content="luxury home, tour">');
		expect(html).toContain('<meta name="alternate-title" content="A Tour You Won&#39;t Forget">');
		expect(html).toContain('<meta name="dcterms.source" content="https://youtu.be/x">');
	});

	it("正文：h1 → 引言 → 各节 h2 + 配图 + 段落，内容已转义", () => {
		expect(html).toContain("<h1>Inside a $50M Home</h1>");
		expect(html).toContain('<img src="images/00-intro.jpg" alt="Inside a $50M Home" width="1280" height="720">');
		expect(html).toContain("<h2>2. Café &amp; Bar</h2>");
		expect(html).toContain('alt="Café &amp; Bar"');
		expect(html).toContain("<p>Drinks *all* day.</p>");
	});

	it("不引用任何外部资源", () => {
		expect(html).not.toMatch(/(src|href)="https?:/);
	});

	it("notes 绝不进 HTML（铁律 #4）", () => {
		expect(html).not.toContain("中文");
	});

	it("imageSrc 可替换为 data URI（单文件版）；缺图跳过", () => {
		const out = renderHtml(buildExportDoc(ARTICLE), {
			imageSrc: (img) => `data:image/jpeg;base64,${img.timestamp}`,
			missing: new Set(["02-cafe-bar.jpg"]),
		});
		expect(out).toContain('src="data:image/jpeg;base64,00_00_05"');
		expect(out).not.toContain("00_02_10");
		expect(out).not.toContain('src="images/');
	});
});

describe("copyExportImages", () => {
	it("按规划文件名原样拷贝；缺图与非法时间戳记 warning 并标记 missing；重跑清掉旧文件", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "diggo-export-"));
		const hd = path.join(root, "01_hd");
		const images = path.join(root, "article", "images");
		await mkdir(hd, { recursive: true });
		await mkdir(images, { recursive: true });
		await writeFile(path.join(hd, "00_00_05.jpg"), "intro-bytes");
		await writeFile(path.join(hd, "00_01_32.jpg"), "entrance-bytes");
		await writeFile(path.join(images, "99-stale.jpg"), "old"); // 上次导出的残留

		const doc = buildExportDoc({
			...ARTICLE,
			pages: [
				ARTICLE.pages[0]!,
				ARTICLE.pages[1]!,
				ARTICLE.pages[2]!, // 00_02_10 不存在 → 缺图
				{ subhead: "3. Escape", image: "../../secret", body: "b" }, // 非法时间戳
			],
		});
		const { missing, warnings } = await copyExportImages(doc, hd, images);

		expect((await readdir(images)).sort()).toEqual(["00-intro.jpg", "01-grand-entrance.jpg"]);
		expect(await readFile(path.join(images, "01-grand-entrance.jpg"), "utf-8")).toBe("entrance-bytes");
		expect([...missing].sort()).toEqual(["02-cafe-bar.jpg", "03-escape.jpg"]);
		expect(warnings).toEqual(["配图缺失，已跳过: 00_02_10", "配图时间戳非法，已跳过: ../../secret"]);
		// 源全集只读不动。
		expect((await readdir(hd)).sort()).toEqual(["00_00_05.jpg", "00_01_32.jpg"]);
	});
});
