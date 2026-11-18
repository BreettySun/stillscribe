#!/usr/bin/env bash
#
# 一键打包 macOS 应用并恢复开发环境。可在仓库**任意目录**调用：
#   pnpm dist            # 推荐（仓库根 package.json 已封装本脚本）
#   bash scripts/package-mac.sh
#
# 做两件事：
#   1) 打包：electron-vite build → 引擎 bundle → better-sqlite3 重编(Electron ABI) → electron-builder
#      产物：release/stillscribe-<version>-arm64.dmg
#   2) 恢复：把 better-sqlite3 重编回系统 Node ABI（否则引擎 dev/test 会坏）。
#      用 trap EXIT 保证即使打包失败也会恢复，不把开发环境留在半坏状态。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

restore() {
  echo ""
  echo "→ 恢复 better-sqlite3 为系统 Node ABI（dev/test）…"
  node "$ROOT/scripts/restore-better-sqlite3.mjs"
}
trap restore EXIT

echo "→ 打包 macOS (arm64)…"
pnpm --filter @stillscribe/desktop dist
status=$?

if [ $status -eq 0 ]; then
  echo ""
  echo "✅ 打包完成：$ROOT/release/"
  ls -lh "$ROOT"/release/*.dmg 2>/dev/null || true
fi
exit $status
