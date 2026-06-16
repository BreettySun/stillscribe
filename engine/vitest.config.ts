import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// 让 vitest 解析与 tsconfig 一致的 @shared 别名（值导入需运行时解析）。
export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
    },
  },
});
