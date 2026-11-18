# 第三方组件声明

本仓库自身的源码以 [MIT 许可证](LICENSE) 发布。下面列出它依赖或随安装包分发的第三方组件，这些组件各自适用自己的许可证，**不受本仓库的 MIT 许可证约束**。

## 一、外部命令行工具（不在仓库内）

这四个可执行文件不进 git。`pnpm --filter @diggo/engine setup-tools` 会按 [engine/scripts/setup-tools.ts](engine/scripts/setup-tools.ts) 里固定的地址和 sha256 把它们下载到 `bin/`，打包时再随安装包一起分发。引擎只以独立子进程的方式调用它们，不链接其代码。

| 工具 | 版本 | 来源 | 许可证 |
| --- | --- | --- | --- |
| ffmpeg / ffprobe | 8.1 | [osxexperts.net](https://www.osxexperts.net/) 的 macOS arm64 静态构建 | **GPL v2 或更高版本**（该构建带 `--enable-gpl`，含 libx264、libx265 等） |
| yt-dlp | 2026.06.09 | [yt-dlp 官方发布](https://github.com/yt-dlp/yt-dlp/releases) | Unlicense；其独立可执行文件内另含的组件见该项目的发布说明 |
| deno | 2.8.3 | [Deno 官方发布](https://github.com/denoland/deno/releases) | MIT |

### 分发安装包时要注意 ffmpeg 的 GPL 义务

只使用源码、或自己在本机运行，不涉及这一条。但如果你**把打包好的应用（dmg）分发给别人**，其中包含 GPL 许可的 ffmpeg 和 ffprobe 二进制，你需要履行 GPL 对二进制分发的要求，主要是：

- 随附 GPL 许可证全文，并说明安装包内含 GPL 许可的 ffmpeg；
- 向接收者提供这份二进制对应的源码，或提供获取源码的书面要约。

上面的二进制由第三方（osxexperts.net）构建，对应源码为 FFmpeg 8.1 及其启用的各个库。想避开 GPL 义务，可以改用自行编译的 LGPL 配置的 ffmpeg，前提是保留本项目用到的 `libwebp` 编码器（`setup-tools` 的自检会验证这一点）。

本节只是提醒，不构成法律意见。

## 二、主要运行时依赖

完整清单与确切版本以 [pnpm-lock.yaml](pnpm-lock.yaml) 为准，各包的许可证文本在其自身的发布包内。

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) | 桌面应用外壳 | MIT |
| [Vue](https://github.com/vuejs/core)、[Pinia](https://github.com/vuejs/pinia) | 界面框架与状态管理 | MIT |
| [Naive UI](https://github.com/tusen-ai/naive-ui)、[@vicons/ionicons5](https://github.com/07akioni/xicons) | 界面组件与图标 | MIT |
| [Fastify](https://github.com/fastify/fastify)、[@fastify/cors](https://github.com/fastify/fastify-cors) | 引擎的本地 HTTP 服务 | MIT |
| [docx](https://github.com/dolanmiu/docx) | 生成 Word 文档 | MIT |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | 任务与设置存储 | MIT |
| [sharp](https://github.com/lovell/sharp) | 去重时计算感知哈希（其依赖的 libvips 为 LGPL） | Apache-2.0 |
| [@google/genai](https://github.com/googleapis/js-genai) | 调用 Gemini | Apache-2.0 |

## 三、外部服务

本工具会访问以下第三方服务，使用时须遵守它们各自的服务条款：

- **YouTube**：通过 yt-dlp 下载视频与字幕。
- **Google Gemini API**：自动生成文章时调用，需要你自己的 API Key，并按 Google 的条款与定价计费。

本项目与 YouTube、Google 没有任何关联，也未获得其认可或背书。
