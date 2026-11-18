# StillScribe

把一条 YouTube 视频变成一篇**带关键配图、可以直接发布的文章**。

贴入视频链接，StillScribe 在你自己的电脑上完成下载、逐秒截图、挑选画面，再让 Gemini 对照字幕和画面写出文章，并为每一段指定最贴切的那一帧。你校对、换图，然后一键导出 Word、Markdown 和 HTML。

- **面向营销和内容团队**：产出的是有标题、SEO 关键词、description 和配图的成稿，不是学习笔记。
- **配图由模型按画面挑选**：每一页的图对应视频里具体的某一秒，而不是按固定间隔随便截。
- **人工可以随时换图**：每一秒的画面都留在本地，校对时点一下就能换成前后任意一帧。
- **全程在本机运行**：视频、截图、文章都不离开你的电脑，对外只访问 YouTube 和 Gemini，用的是你自己的 API Key。

> **项目状态**：早期版本（0.1.0）。目前只支持 Apple 芯片的 macOS，需要从源码运行或自行打包，还没有提供现成的安装包。

---

## 它会产出什么

每个任务在工作目录下得到一个文件夹，导出的成品都在其中的 `article/` 里：

```
article/
├── article_final.docx        # Word，配图已内嵌
├── article.md                # Markdown，标题 / description / 关键词写在 front matter
├── article.html              # 完整的 HTML 页面，SEO 信息在 <head> 里
├── article.standalone.html   # 图片内嵌的单文件 HTML，方便直接发给别人预览
└── images/                   # Markdown 和 HTML 共用的配图
    ├── 00-intro.jpg
    ├── 01-nestled-in-nature.jpg
    └── …
```

配图按"页序号-小标题"命名，1280×720，可以直接上传到你的 CMS。

---

## 工作流程

```
视频链接 ─→ 下载 ─→ 逐秒截图 ─→ 去重选帧 ─→ 拼宫格图 ─→ Gemini 写文章并选图 ─→ 人工校对换图 ─→ 导出
```

| 步骤 | 做什么 |
| --- | --- |
| 下载 | 用 yt-dlp 取视频和英文字幕（人工字幕或自动字幕） |
| 逐秒截图 | 用 ffmpeg 每秒截一帧，同时生成带时间水印的小图和 1280×720 的高清图 |
| 去重选帧 | 用感知哈希合并相似画面，只把有代表性的帧交给模型，省 token |
| 拼宫格图 | 把代表帧每 50 张拼成一张带时间标记的宫格图 |
| 写文章 | Gemini 对照字幕和宫格图生成结构化文章，每页给出标题、正文和配图所在的时刻 |
| 校对换图 | 在界面里逐页检查，点击配图可从逐秒画面里换一张 |
| 导出 | 程序化生成 docx、Markdown、HTML |

每一步的产物都落在磁盘上，失败后重试会从断点继续，不会从头再来。

---

## 快速开始

### 环境要求

- macOS，Apple 芯片
- Node.js 22.12 或更新的 LTS（Electron 43 的安装器要求）
- [pnpm](https://pnpm.io/)

ffmpeg、yt-dlp 这些工具**不需要自己安装**，下面的 `setup-tools` 会把固定版本下载到仓库的 `bin/` 目录。

### 安装

```bash
git clone https://github.com/BreettySun/stillscribe.git
cd stillscribe
pnpm install
pnpm --filter @stillscribe/engine setup-tools
```

### 配置 Gemini API Key

```bash
cp engine/.env.example engine/.env
```

打开 `engine/.env`，把在 [Google AI Studio](https://aistudio.google.com/apikey) 申请的 Key 填到 `STILLSCRIBE_GEMINI_API_KEY`。

不填也能用：任务会照常跑到宫格图那一步，然后停下来，等你把宫格图和字幕交给任意模型，再把生成的文章 JSON 粘贴回来（界面里叫"半自动"模式）。

### 启动

```bash
pnpm dev
```

桌面窗口打开后：

1. 在"新建任务"里贴入 YouTube 链接，一行一个，一次最多 10 个。
2. 等左侧队列里的任务变成"待校对"。
3. 点开任务逐页检查，点击配图可以从逐秒画面里换一张。要改文字，展开"重新回填 JSON"修改后保存。
4. 点"确认并导出"，三种格式的文件一次生成。

YouTube 经常要求登录验证。遇到这种情况时，应用会自动从你的浏览器读取 YouTube 的登录态并重试，所以请先在浏览器里登录 YouTube。用哪个浏览器可以在窗口右上角切换。

---

## 其他用法

### 命令行

不开界面，直接跑一条任务：

```bash
cd engine
pnpm run run "https://www.youtube.com/watch?v=…" --mode auto
```

可用参数：`--quality 1080|1440`、`--mode auto|semi`、`--browser safari|chrome`、`--threshold <去重阈值>`、`--work-root <目录>`。产物在 `engine/work/` 下。

### 打包成应用

```bash
pnpm dist
```

安装包生成在 `release/` 下。它没有经过 Apple 签名和公证，首次打开需要在 Finder 里右键选择"打开"。

打包后的应用不读 `engine/.env`。首次使用前，把 Key 写进下面这个文件，应用启动时会把它加密存入系统钥匙串，并删掉这份明文：

```
~/Library/Application Support/stillscribe/gemini-key.txt
```

自行打包并分发给他人之前，请先阅读 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 里关于 ffmpeg 许可证的说明。

### 调整文章风格

默认的提示词会生成一篇 11 到 21 页的英文翻页文章，附带 3 个候选标题和 SEO 关键词。新建任务时可以展开"提示词"编辑本次使用的版本；想改默认值，编辑 [engine/src/modules/m7/prompt.template.txt](engine/src/modules/m7/prompt.template.txt)。

### 更多配置

模型、端口、工作目录等都可以通过环境变量调整，完整列表和说明见 [engine/.env.example](engine/.env.example)。

---

## 目前的限制

- **只支持 Apple 芯片的 macOS。** 没有 Windows、Linux 和 Intel Mac 的版本。
- **只取英文字幕。** 没有英文字幕的视频也能处理，但模型只能靠画面写作。
- **默认提示词面向英文文章。** 生成其他语言或其他体裁需要自己改提示词。
- **只接入了 Gemini。**
- **配图固定为 1280×720**，暂不支持裁剪和生成封面图。
- **安装包未签名**，也没有自动更新。
- **界面只有中文**，校对页也还不能直接改文字，只能修改文章的 JSON。
- **下载依赖 yt-dlp。** YouTube 调整反爬策略后可能需要更新 yt-dlp 才能继续下载。

---

## 隐私与安全

- 视频、截图、文章和数据库都保存在本机，不上传到任何服务器。
- 出站请求只有两类：经 yt-dlp 访问 YouTube，以及调用 Gemini API。调用 Gemini 时，字幕和宫格图会发送给 Google。
- 从浏览器读取的 YouTube cookie 只写在本机工作目录。
- 界面和处理引擎是两个本地进程，它们之间的接口带令牌鉴权，本机浏览器里的其他网页无法调用。

安全边界的完整说明和漏洞报告方式见 [SECURITY.md](SECURITY.md)。

---

## 适用范围与免责声明

这个工具面向**你自己拥有版权、或已获得权利人授权的视频**，比如自家频道的内容、客户委托处理的素材。使用前请了解：

- **平台条款**：下载 YouTube 视频可能违反 YouTube 的服务条款。是否可以下载、如何使用下载的内容，由使用者自行判断并承担责任。
- **截图的版权**：导出的文章里嵌有视频截图。把他人视频的画面用于公开发布，尤其是商业或营销用途，通常需要权利人许可。本工具不替你判断某段素材能否使用。
- **AI 生成内容**：文章由模型生成，人名、品牌、数字、事实都可能出错。发布前请人工核对，校对页就是为此准备的。
- **无关联声明**：本项目与 YouTube、Google 没有任何关联，也未获得其认可或背书。
- **无担保**：软件按"现状"提供，不附带任何担保，详见 [LICENSE](LICENSE)。

以上不构成法律意见。

---

## 参与开发

```
shared/     界面与引擎共用的类型定义，是两端之间唯一的契约
engine/     处理引擎：各步骤模块、任务队列、本地 HTTP 服务、命令行入口
ui/         界面（Vue 3）
electron/   桌面外壳：创建窗口，启动并看护引擎进程
docs/       架构文档与开发计划
```

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 引擎、界面、桌面外壳一起启动 |
| `pnpm dev:engine` / `pnpm dev:ui` | 只启动引擎，或只启动网页版界面 |
| `pnpm test` | 引擎单元测试 |
| `pnpm typecheck` | 三个包的类型检查 |
| `pnpm dist` | 打包 macOS 应用 |
| `pnpm refresh-cookies` | 手动从浏览器刷新 YouTube cookie |

技术栈：Electron 43、Vue 3、Vite 6、Naive UI、Pinia、Fastify 5、TypeScript 5、better-sqlite3、sharp、docx。

提交代码之前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。项目的硬性约束写在 [CLAUDE.md](CLAUDE.md)，设计取舍见 [docs/](docs/) 下的架构文档。

---

## 许可证

本仓库的源码以 [MIT 许可证](LICENSE) 发布。

随安装包分发的 ffmpeg / ffprobe 是 GPL 许可的第三方二进制，不在 MIT 范围内。依赖和内置工具各自的许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
