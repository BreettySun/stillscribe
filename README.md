# Diggo Press

把 **YouTube 视频 → 图文文章** 的手工流程封装成纯桌面 macOS 应用。一条 URL 进去，自动完成下载、逐秒抽帧加水印、去重选帧、拼宫格图，再由 Gemini 生成结构化文章，最后程序化导出带配图的 `.docx`。

> 形态：**Electron + Vue（UI）+ Node/TS 引擎（本地进程）**。重活全在引擎；UI 是薄客户端，两者通过本地 HTTP/SSE 通信。
> 详细设计见 `[docs/](docs/)`（架构文档、开发计划、前端架构）；开发硬约束见 `[CLAUDE.md](CLAUDE.md)`。

---

## 处理流水线


| 模块          | 职责                                                         | 工具       |
| ----------- | ---------------------------------------------------------- | -------- |
| **M2** 下载   | yt-dlp 取 mp4 + 英文字幕（人工/自动）转 srt                            | `yt-dlp` |
| **M3** 帧生成  | 一趟 ffmpeg 同时产 640×360 + 水印 webp 全集 与 1280×720 HD 全集（无二次编码） | `ffmpeg` |
| **M5** 去重   | sharp/phash 选代表帧，只产代表帧清单，逐秒全集不动（默认开启）                      | `sharp`  |
| **M6** 宫格图  | ffmpeg `tile` 滤镜拼图，10×5/组，cell 320×180，喂 Gemini            | `ffmpeg` |
| **M7** 文章   | Gemini → 结构化 JSON（`Article`），中文说明只进 `notes`                | Gemini   |
| **M8** docx | `docx`(dolanmiu) 程序化生成，配图取 1280 HD 等比居中                    | `docx`   |


每个模块**幂等、产物落盘、可单步重跑**——失败重试或从中间步骤恢复，无需从头再来。

---

## 仓库结构

```
.
├── shared/types.ts     # 前后端唯一类型契约（要改结构先改这里）
├── engine/             # Node/TS 引擎：M2..M8 模块 + 编排 + 本地 HTTP/SSE 服务
│   ├── src/modules/    #   各处理模块
│   ├── src/orchestrator/  # 队列/状态机/事件总线
│   ├── src/cli/        #   外部 CLI 绝对路径封装
│   ├── src/run.ts      #   命令行入口（P1）
│   └── src/serve.ts    #   服务进程入口（P2）
├── ui/                 # Vue 3 渲染进程（Vite + naive-ui + Pinia）
├── electron/           # Electron 主进程：创建窗口 + spawn/监督引擎
├── bin/                # 内置 CLI 二进制（pnpm setup-tools 下载，不进 git）
└── scripts/            # 打包 / 图标 / 修复脚本
```

工作目录产物（`work/<任务ID_标题>/`，不进 git）：`source/`、`01_hd/`、`02_webp/`、`03_grids/`、`article/`、`task.json`。

---

## 环境要求

- macOS（当前仅打包 arm64）
- Node.js LTS
- pnpm

外部 CLI（`ffmpeg`/`ffprobe`/`yt-dlp`/`deno`）**不依赖系统安装**——由 `setup-tools` 下载自包含二进制到 `bin/`，引擎一律以绝对路径 spawn。

---

## 快速开始

```bash
pnpm install

# 下载内置 CLI 二进制到 bin/（ffmpeg / ffprobe / yt-dlp / deno）
pnpm --filter @diggo/engine setup-tools
```

### 命令行跑通单条任务（P1）

```bash
cd engine
pnpm run <youtube_url> [--quality 1080|1440] [--browser safari|chrome] [--threshold N] [--work-root <dir>]
```

打通 M2 → M3 → M5 → M6 → M8。M7（文章生成）当前由人工/Claude 读宫格图 + 字幕生成 `article.json` 回填，M8 依赖其存在。

> **YouTube 鉴权**：YouTube 常要求登录验证。在 `<work-root>/cookies.txt` 放置 cookie 文件，或用 `--browser` 走 `yt-dlp --cookies-from-browser`。密钥与 cookie 只在本地，禁止提交进仓库。

### 桌面 App 开发模式（引擎 + UI + Electron 一起启动）

```bash
pnpm dev
```

或分别启动：`pnpm dev:engine`、`pnpm dev:ui`、`pnpm dev:desktop`。

引擎服务环境变量：`DIGGO_WORK_ROOT`（默认 `./work`）、`DIGGO_PORT`（默认 `8787`）、`DIGGO_HOST`（默认 `127.0.0.1`）、`DIGGO_BROWSER`。

---

## 常用脚本


| 命令                     | 说明                                     |
| ---------------------- | -------------------------------------- |
| `pnpm dev`             | 并行启动 engine + ui + desktop             |
| `pnpm test`            | 引擎单测（vitest）                           |
| `pnpm typecheck`       | 全 workspace 类型检查                       |
| `pnpm dist`            | 打包 macOS App（`scripts/package-mac.sh`） |
| `pnpm refresh-cookies` | 从浏览器刷新 YouTube cookie                  |


---

## 开发约束（摘要）

完整规则见 `[CLAUDE.md](CLAUDE.md)`，几条铁律：

1. 外部 CLI 一律**绝对路径 spawn**，打包后经 `process.resourcesPath` 解析。
2. 抽帧/缩放/加水印/转 webp **由 ffmpeg 一趟完成**；`sharp` 只用于算 phash，不再编码出图。
3. `shared/types.ts` 是**前后端唯一契约**：先改类型，再改实现，两端同步。
4. 去重只筛"喂 AI 的代表帧"，逐秒全集（`01_hd/`、`02_webp/`）**永不删除**。
5. 渲染进程安全默认：`contextIsolation: true`、`nodeIntegration: false`；状态归引擎 + SQLite，不用 localStorage 持久化。
6. 出站请求只允许 YouTube(yt-dlp)、Gemini、飞书；密钥/cookie 仅本地。

> `better-sqlite3` / `sharp` 是原生模块。打包后会改写 sqlite ABI，需 `electron-rebuild` 重编（见 `scripts/restore-better-sqlite3.mjs`）。

---

## 技术栈

Electron 33 · Vue 3 + Vite 6 · naive-ui · Pinia · Fastify 5 · TypeScript 5 · `docx` · `sharp` · `better-sqlite3` · pnpm workspace。