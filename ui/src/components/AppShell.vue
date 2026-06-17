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
	onUnmounted,
	watchEffect,
	type Component,
} from "vue";
import { NIcon, useThemeVars, type DropdownOption } from "naive-ui";
import { DesktopOutline, MoonOutline, SunnyOutline } from "@vicons/ionicons5";
import { useTasksStore } from "../stores/tasks";
import { useEngineStore } from "../stores/engine";
import { useThemeStore, type ThemeMode } from "../stores/theme";
import { connectEvents } from "../api/events";
import QueuePanel from "./queue/QueuePanel.vue";
import ContextPane from "./ContextPane.vue";

const store = useTasksStore();
const engine = useEngineStore();
const theme = useThemeStore();
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
	document.documentElement.style.colorScheme = theme.isDark ? "dark" : "light";
});

const menuIcon = (cmp: Component) => () =>
	h(NIcon, { size: 16 }, { default: () => h(cmp) });
const THEME_OPTIONS: DropdownOption[] = [
	{ label: "跟随系统", key: "auto", icon: menuIcon(DesktopOutline) },
	{ label: "浅色", key: "light", icon: menuIcon(SunnyOutline) },
	{ label: "深色", key: "dark", icon: menuIcon(MoonOutline) },
];
const currentIcon = computed(() =>
	theme.mode === "light"
		? SunnyOutline
		: theme.mode === "dark"
			? MoonOutline
			: DesktopOutline,
);

onMounted(async () => {
	// 初始 HTTP 拉取一次，之后由 SSE 增量更新。
	void theme.load(); // 恢复持久化的主题偏好
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
			<span class="app-title">Diggo Press</span>
			<span class="app-subtitle">YouTube 视频 → 图文文章</span>
			<span class="app-engine">
				<span
					class="dot"
					:style="{ background: statusMeta.color }" />
				{{ statusMeta.text }}
			</span>
			<n-dropdown
				trigger="click"
				:options="THEME_OPTIONS"
				@select="(k: ThemeMode) => theme.setMode(k)">
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
		</header>
		<n-split
			:default-size="'360px'"
			:max="0.5"
			:min="'300px'">
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
	gap: 14px;
	padding: 0 18px;
	height: 48px;
	border-bottom: 1px solid var(--c-border);
	flex-shrink: 0;
}
.app-title {
	font-weight: 600;
	font-size: 15px;
}
.app-subtitle {
	color: var(--c-muted);
	font-size: 12px;
}
.app-engine {
	margin-left: auto;
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
.app-body {
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
	flex: 1;
	min-width: 0;
	min-height: 0;
	overflow: auto;
}
</style>
