# CLAUDE.md — 项目规则（AI 开发护栏）

> 本文件是仓库的"宪法"，每次开工先读。配套：《视频生成文章-架构文档》v0.5、《视频生成文章-开发计划》。
> 文档讲"做什么、为什么"；本文件讲"怎么做的硬约束、不许做什么"。两者冲突时，以架构文档的设计意图为准，并提出来讨论，不要擅自改。

---

## 1. 项目概述

把"YouTube 视频 → 图文文章"的手工流程封装成**纯桌面 macOS 应用**。一条 URL 进去，自动完成下载、逐秒抽帧加水印、去重选帧、拼宫格图，再由用户所选的模型生成结构化文章，最后程序化导出带配图的本地文件（docx / Markdown / HTML）。

形态：**Electron + Vue（UI）+ Node/TS 引擎（本地进程）**，两者通过本地 HTTP/WS 通信。重活全在引擎；UI 是薄客户端。详见架构文档。

---

## 2. 技术栈（版本锁定，不得擅自更换）

- **UI 宿主**：**Electron**（主进程 Node + 渲染进程 Vue 3）+ Vite + TypeScript；打包用 **electron-builder**
- **引擎**：Node.js LTS + TypeScript，Web 框架 Fastify 或 Hono
- **关键库**：`docx`(dolanmiu) 生成 Word、`sharp`(+phash) 去重、`better-sqlite3` 任务库
- **外部 CLI**（内置二进制）：yt-dlp、ffmpeg/ffprobe（宫格拼图改用 ffmpeg `tile` 滤镜，已弃用 ImageMagick）
- **包管理**：pnpm 或 bun（全程统一一种）
- **打包**：electron-builder；原生模块经 **electron-rebuild** 编译，CLI 经 **extraResources** 内置

> 全栈为**纯 JS/TS、无 Rust**（主进程 Node + 渲染进程 Vue + Node 引擎）。不要引入 Tauri/Rust 相关写法——本项目已选定 Electron。

---

## 3. 铁律（违反即视为 bug）

1. **外部 CLI 一律用绝对路径 spawn**，禁止依赖 PATH、禁止假设用户全局装了 ffmpeg/yt-dlp。开发期可用配置指向本机路径，打包后用 `process.resourcesPath` 解析 bundle 内路径。（打包后启动只有精简 PATH，依赖 PATH 必然失效。）
2. **引擎内禁止引入图像库做二次解码/编码**。抽帧、缩放、加水印、转 webp 由 **ffmpeg 一趟（M3）** 完成。`sharp` 只用于 M5 去重时算 phash，不得用它再编码出图。
3. **共享类型即契约**。`shared/types.ts` 是前后端唯一事实来源。要改数据结构，**先改类型、再改实现**，并保证渲染进程与引擎端同步。不得在某一端私自定义"影子结构"。
4. **M7 的中文说明 / CoT 只能进 `ArticleNotes`**，绝不进 `body`、绝不进任何导出文件（docx / Markdown / HTML）。正文字段保持纯净、可直接发布。
5. **去重（M5）只筛"喂 AI 的代表帧"**，默认开启。逐秒全集（`01_hd/`、`02_webp/`）**永不删除/移动**，人工换图依赖它。
6. **密钥与隐私只在本地**。模型服务 API Key、浏览器 cookie 等：禁止硬编码、禁止提交进仓库、禁止写进 URL/query 参数、禁止发往架构未声明的第三方。出站请求只允许 YouTube(yt-dlp) 与**用户在设置中配置的模型服务地址**（默认 Google Gemini）。API Key 与其接口地址绑定，绝不发往其他地址。导出产物一律是本地文件，不上传任何第三方（飞书集成已于 2026-11 移除）。
7. **每个模块幂等、产物落盘、可单步重跑**。失败重试或从中间步骤恢复，不能要求从头再来。
8. **UI 与引擎是独立进程**，保证崩溃隔离。引擎由 Electron 主进程 spawn（utilityProcess/fork），重处理逻辑不塞进渲染进程。**渲染进程通过 localhost HTTP 访问引擎，不用 Electron IPC 直连引擎**（以保留"先 Web 后套壳"）。**引擎的每个 HTTP 路由都必须过鉴权**（令牌 + 来源 + Host，见 `engine/src/auth.ts`）：只监听 127.0.0.1 挡不住本机浏览器里的网页。令牌只走请求头、不进 URL，渲染进程代码不持有令牌（Electron 主进程在网络层附加；纯 Web 开发模式由 Vite 代理附加）。新增路由不得绕过鉴权钩子。
9. **渲染进程安全默认**：`contextIsolation: true`、`nodeIntegration: false`；不在渲染进程直接用 Node/fs。**禁止用 localStorage/sessionStorage 做持久化**，状态归引擎 + SQLite。
10. **不擅自推翻已决策方案**。为什么纯桌面、为什么 Electron+Vue / Node-TS、为什么不用 Swift/Python/Tauri，见架构文档第 2、3 节。有异议先提出，不要直接改。

---

## 4. 目录结构

### 4.1 仓库结构（建议）

```
.
├── CLAUDE.md
├── docs/                      # 架构文档、开发计划、ADR、现有命令清单
├── shared/                    # 共享 TS 类型（契约）
│   └── types.ts
├── engine/                    # Node/TS 引擎
│   ├── src/
│   │   ├── modules/           # M2..M10 各模块
│   │   ├── orchestrator/      # 队列/限流/状态机
│   │   ├── cli/               # 外部 CLI 绝对路径封装
│   │   ├── server.ts          # 本地 HTTP/WS
│   │   └── run.ts             # P1 命令行入口
│   └── package.json
├── ui/                        # Vue 3 渲染进程
│   └── src/
├── electron/                  # Electron 主进程（P3b 才加）
│   ├── main.ts                # 创建窗口 + spawn/监督引擎
│   └── preload.ts
├── bin/                       # 内置 CLI 二进制（extraResources 打包用）
└── electron-builder.yml       # 打包/签名/公证配置
```

### 4.2 任务工作目录（产物，不进 git）

```
<工作根目录>/<任务ID_视频标题>/
├── source/      # 原始 mp4 + 字幕
├── 01_hd/       # 1280x720 逐秒 HD（换图浏览 + M8 配图源）
├── 02_webp/     # 640x360 + 水印 逐秒 webp（M5/M6 用）
├── 03_grids/    # 去重后代表帧拼的宫格图（喂模型）
├── article/     # article.json (M7) + M8 导出：article_final.docx、article.md、article.html、
│                #   article.standalone.html（图片内嵌单文件）、images/（md/html 共用配图）
├── mp4_clips/   # 视频切片（可选）
└── task.json    # 任务元数据快照
```

---

## 5. 命名与约定

- **帧命名**：`HH_MM_SS`（如 `00_01_23`）。fps=1 从 0 开始，第 N 帧即第 N 秒，纯算术映射，**不要复制出第二份重命名文件夹**。
- 时间戳类型在代码里统一用 `Timestamp`（见 `shared/types.ts`），格式即 `HH_MM_SS`。
- 路径常量集中在一个模块管理，不在各处硬编码字符串拼路径；打包后路径用 `process.resourcesPath` 解析。
- 代码与注释可用中文；但**面向发布的文章正文（body）只含目标语言内容**，不混说明性中文。

---

## 6. 模块边界（M0–M10，细节见架构文档第 5 节）

| 模块 | 职责 | 关键约束 |
|---|---|---|
| M2 下载 | yt-dlp 取 mp4+字幕 | 默认 1080p（`<=`）、人工+自动英文字幕转 srt、`--cookies-from-browser` |
| M3 帧生成 | 一趟 ffmpeg | 同时产 640×360+水印 webp 全集 与 1280 HD 全集；无二次编码 |
| M5 去重 | sharp/phash 选代表帧 | 默认开；只产代表帧清单；全集不动 |
| M6 宫格图 | ffmpeg `tile` 滤镜拼图（原 ImageMagick montage，为自包含已弃用） | 输入是代表帧，10×5/组，cell 320×180 |
| M7 文章 | 模型（OpenAI 兼容接口）→ 结构化 JSON | 输出对齐 `Article` 类型；中文说明进 notes |
| M8 导出 | 程序化生成本地文件：docx(dolanmiu) / Markdown / HTML | 配图取 1280 HD；md/html 的配图从 `01_hd` **原样拷贝**到 `article/images/`（不再编码，铁律 #2）；一次生成，不走"先生成再调图" |
| M9 发布 | 已取消（2026-11） | 产出以本地文件为主，不再对接飞书；发布到 CMS 由用户拿导出文件自行完成 |
| M10 切片 | ffmpeg 切片 | 可选、低优先 |

---

## 7. 开发流程与验收

- 按开发计划推进：**Spike → P1(命令行引擎) → P2(服务化) → P3a(纯 Web)→ P3b(Electron 套壳) → P4(打包)**。
- **先让命令行引擎跑通**（`run.ts <url>` 出导出文件），再服务化、再上 UI。不要过早引入 Electron。
- 每个模块写到"给定输入 → 应产出什么"可断言的程度，尽量配最小测试。
- 改动涉及契约（`shared/types.ts`）时，在 PR/提交说明里点出契约变更。

---

## 8. AI 协作专项注意

- 本项目用 **Electron**，不要混入 Tauri/Rust 写法；渲染进程保持 `contextIsolation: true` / `nodeIntegration: false`。
- 引入 `sharp`/`better-sqlite3` 等**原生模块**时，记得它们带原生二进制，Electron 下需 **electron-rebuild** 编译、含 `.node` 的包放 `asarUnpack`（见开发计划 S4）；不确定就在 PR 里标出。
- 不要凭空编造 yt-dlp/ffmpeg 的参数——**以项目里既有的、已验证过的命令为准**（待用户提供脚本/命令清单后录入 `docs/`）。
- 不要重写已调好的提示词，只在其基础上改造成 JSON 输出。
- 涉及第三方网页/字幕/视频内容时，遵守版权：不整段复制受版权文本。
