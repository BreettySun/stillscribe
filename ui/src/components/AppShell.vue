<script setup lang="ts">
/**
 * 主壳（在 n-config-provider 之内）：标题栏 + 状态灯 + 主题切换 + 两栏。
 * 用 useThemeVars() 把 Naive UI 主题变量发布成 --c-* CSS 变量，供各子组件的 scoped 样式消费，
 * 从而明暗主题统一切换（不再硬编码颜色）。
 */
import {
	computed,
	h,
	onMounted,
	ref,
	onUnmounted,
	watchEffect,
	type Component,
} from "vue";
import { NIcon, useThemeVars, type DropdownOption } from "naive-ui";
import {
	DesktopOutline,
	MoonOutline,
	SunnyOutline,
	GlobeOutline,
	SettingsOutline,
} from "@vicons/ionicons5";
import type { CookieBrowser } from "@shared/types";
import { useTasksStore } from "../stores/tasks";
import { useEngineStore } from "../stores/engine";
import { useSettingsStore, type ThemeMode } from "../stores/settings";
import { useAIStore } from "../stores/ai";
import { connectEvents } from "../api/events";
import QueuePanel from "./queue/QueuePanel.vue";
import ContextPane from "./ContextPane.vue";
import AISettingsDialog from "./settings/AISettingsDialog.vue";

const store = useTasksStore();
const engine = useEngineStore();
const settings = useSettingsStore();
const ai = useAIStore();
const showAISettings = ref(false);
const vars = useThemeVars();

let disconnect: (() => void) | undefined;

const statusMeta = computed(() => {
	switch (engine.status) {
		case "connected":
			return { color: vars.value.successColor, text: "引擎已连接" };
		case "connecting":
			return { color: vars.value.warningColor, text: "连接中…" };
		default:
			return { color: vars.value.errorColor, text: "引擎已断开" };
	}
});

// 把主题变量映射成 --c-* 自定义属性（在 .app-shell 上，子组件继承）。
const cssVars = computed(() => ({
	"--c-text": vars.value.textColor2,
	"--c-muted": vars.value.textColor3,
	"--c-border": vars.value.borderColor,
	"--c-accent": vars.value.primaryColor,
	"--c-warn": vars.value.warningColor,
	"--c-error": vars.value.errorColor,
	"--c-hover": vars.value.hoverColor,
	"--c-body": vars.value.bodyColor,
}));

// 让整窗（含 body 溢出区、原生滚动条/控件）背景/文字/配色方案跟随主题。
watchEffect(() => {
	document.body.style.background = vars.value.bodyColor;
	document.body.style.color = vars.value.textColor2;
	document.documentElement.style.colorScheme = settings.isDark
		? "dark"
		: "light";
});

const menuIcon = (cmp: Component) => () =>
	h(NIcon, { size: 16 }, { default: () => h(cmp) });
const THEME_OPTIONS: DropdownOption[] = [
	{ label: "跟随系统", key: "auto", icon: menuIcon(DesktopOutline) },
	{ label: "浅色", key: "light", icon: menuIcon(SunnyOutline) },
	{ label: "深色", key: "dark", icon: menuIcon(MoonOutline) },
];
const currentIcon = computed(() =>
	settings.mode === "light"
		? SunnyOutline
		: settings.mode === "dark"
			? MoonOutline
			: DesktopOutline,
);

// Cookie 来源浏览器（自动刷新 cookie 时从哪个浏览器导出登录态）。
const BROWSERS: CookieBrowser[] = [
	"chrome",
	"safari",
	"edge",
	"firefox",
	"opera",
];
const BROWSER_OPTIONS: DropdownOption[] = BROWSERS.map((b) => ({
	label: b.charAt(0).toUpperCase() + b.slice(1),
	key: b,
}));

onMounted(async () => {
	// 初始 HTTP 拉取一次，之后由 SSE 增量更新。
	void settings.load(); // 恢复持久化的 UI 偏好（主题 + cookie 浏览器）
	void ai.load(); // 模型服务配置与就绪状态
	await store.fetchAll().catch(() => engine.setStatus("disconnected"));
	disconnect = connectEvents({
		onEvent: (e) => store.applyEvent(e),
		onOpen: () => engine.setStatus("connected"),
		onError: () => engine.setStatus("disconnected"),
	});
});
onUnmounted(() => disconnect?.());
</script>

<template>
	<div
		class="app-shell"
		:style="cssVars">
		<header class="app-titlebar">
			<img
				src="@/assets/icon/icon-trans.svg"
				alt="StillScribe"
				width="24"
				height="24" />
			<span class="app-title">StillScribe</span>
			<span class="app-engine">
				<span
					class="dot"
					:style="{ background: statusMeta.color }" />
				{{ statusMeta.text }}
			</span>
			<n-dropdown
				trigger="click"
				:options="BROWSER_OPTIONS"
				:value="settings.cookieBrowser"
				@select="(k: CookieBrowser) => settings.setCookieBrowser(k)">
				<n-button
					quaternary
					circle
					size="small"
					:title="`Cookie 来源浏览器：${settings.cookieBrowser}`"
					aria-label="Cookie 来源浏览器">
					<template #icon>
						<n-icon :component="GlobeOutline" />
					</template>
				</n-button>
			</n-dropdown>
			<n-dropdown
				trigger="click"
				:options="THEME_OPTIONS"
				@select="(k: ThemeMode) => settings.setMode(k)">
				<n-button
					quaternary
					circle
					size="small"
					aria-label="切换主题">
					<template #icon>
						<n-icon :component="currentIcon" />
					</template>
				</n-button>
			</n-dropdown>
			<n-button
				quaternary
				circle
				size="small"
				title="模型服务设置"
				aria-label="模型服务设置"
				@click="showAISettings = true">
				<template #icon>
					<n-icon :component="SettingsOutline" />
				</template>
			</n-button>
		</header>
		<AISettingsDialog v-model:show="showAISettings" />
		<n-split
			:default-size="'360px'"
			:max="0.5"
			:min="'300px'"
			class="app-split">
			<template #1>
				<QueuePanel class="app-queue" />
			</template>
			<template #2>
				<ContextPane class="app-context" />
			</template>
		</n-split>
	</div>
</template>

<style scoped>
.app-shell {
	display: flex;
	flex-direction: column;
	height: 100vh;
	background: var(--c-body);
}
.app-titlebar {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 0 18px 0 14px;
	height: 48px;
	border-bottom: 1px solid var(--c-border);
	flex-shrink: 0;
}
.app-title {
	font-weight: 600;
	font-size: 16px;
}
.app-engine {
	margin-left: auto;
	margin-right: 6px;
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 12px;
	color: var(--c-muted);
}
.app-engine .dot {
	width: 9px;
	height: 9px;
	border-radius: 50%;
}
.app-split {
	flex: 1;
	display: flex;
	min-height: 0;
}
.app-queue {
	flex-shrink: 0;
	border-right: 1px solid var(--c-border);
	min-height: 0;
}
.app-context {
	/* pane-2 是 overflow:hidden 的 block（非 flex），故 flex:1 在此无效；
	   必须给确定高度，overflow:auto 才有 clientHeight 上限、内容超出时才滚动。 */
	height: 100%;
	min-width: 0;
	overflow: auto;
}
</style>
