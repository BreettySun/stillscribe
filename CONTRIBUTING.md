# 参与贡献

欢迎提 issue 和 PR。动手之前花几分钟读完这一页，能省掉大部分来回。

## 先看这两份

- [CLAUDE.md](CLAUDE.md)：项目的硬约束（"铁律"）。不管是人写还是让 AI 写，PR 都按它审。
- [docs/](docs/) 下的架构文档：为什么是纯桌面、为什么用 Electron + Vue + Node 引擎。想改这些已定的方向，请先开 issue 讨论，不要直接提 PR。

## 搭建开发环境

需要 macOS（目前只支持 Apple 芯片）、Node.js 22.12 或更新的 LTS、pnpm。

```bash
pnpm install
pnpm --filter @stillscribe/engine setup-tools   # 下载 ffmpeg / ffprobe / yt-dlp / deno 到 bin/
cp engine/.env.example engine/.env        # 可选：填入模型服务的 API Key 以启用自动生成文章（见文件内说明）
pnpm dev                                  # 引擎 + 界面 + 桌面壳一起启动
```

只想改引擎时，不必启动桌面壳：`pnpm dev:engine` 起服务，或直接用命令行跑单条任务（见 [README.md](README.md)）。

## 提交之前

```bash
pnpm typecheck   # 引擎、界面、桌面壳三处类型检查
pnpm test        # 引擎单元测试
```

两条都要通过。另外请留意：

- **新功能和缺陷修复都要带测试。** 引擎模块按"给定输入，应产出什么"来写断言，测试文件与源文件同目录，命名为 `*.test.ts`。
- **改数据结构先改契约。** `shared/types.ts` 是界面与引擎之间唯一的类型来源：先改它，再改两端实现，并在 PR 说明里点出契约变更。
- **新增 HTTP 路由不得绕过鉴权。** 引擎的每个路由都要过令牌、来源、Host 三道检查，见 [engine/src/auth.ts](engine/src/auth.ts)。
- **不要引入新的出站请求。** 目前只允许访问 YouTube 和用户在设置里配置的模型服务地址。确有需要请先开 issue。
- **不要提交密钥和产物。** `engine/.env`、`cookies.txt`、`bin/`、工作目录都已在 `.gitignore` 里，提交前用 `git status` 再确认一遍。

`pnpm dist` 打包时会把 `better-sqlite3` 重编成 Electron 的版本，脚本结束时会自动恢复。如果打包中途被强行中断，之后测试报原生模块版本不匹配，运行 `node scripts/restore-better-sqlite3.mjs` 即可。

## 提交与 PR

- 提交说明用"类型: 说明"的格式，类型取 `feat`、`fix`、`docs`、`chore`、`refactor`、`test` 之一，说明用中文或英文都可以。例如：`fix: 修复导出时缺图仍写入空图片引用`。
- 一个 PR 只做一件事。顺手发现的无关问题，另开 PR 或 issue。
- PR 说明里写清：改了什么、为什么改、怎么验证的。涉及界面的改动请附截图。

## 报告问题

- **缺陷**：请附上复现步骤、期望结果与实际结果、macOS 与应用版本。日志里如果有 cookie、API Key 或令牌，贴出来之前务必先抹掉。
- **安全问题**：不要开公开 issue，按 [SECURITY.md](SECURITY.md) 私下报告。
- **下载失败**：YouTube 的反爬策略变化很快，多数下载问题出在 yt-dlp 一侧。请先确认浏览器里已登录 YouTube，并运行过 `pnpm refresh-cookies`。

## 许可

提交贡献即表示你同意这些贡献以本项目的 [MIT 许可证](LICENSE) 发布，并确认你有权这样做。
