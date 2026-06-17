<script setup lang="ts">
import { computed } from "vue";
import { darkTheme, lightTheme, zhCN, dateZhCN } from "naive-ui";
import { useThemeStore } from "./stores/theme";
import AppShell from "./components/AppShell.vue";

const theme = useThemeStore();
const naiveTheme = computed(() => (theme.isDark ? darkTheme : lightTheme));
</script>

<template>
  <n-config-provider :theme="naiveTheme" :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider>
      <n-dialog-provider>
        <AppShell />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
