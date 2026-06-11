# P1 端到端验收记录（2026-06-11）

验收视频：`https://www.youtube.com/watch?v=arj7oStGLkU`（Tim Urban TED, 14:04）

## 结果

| 检查点 | 结果 |
|---|---|
| M2 下载（1080p + en 字幕，chrome cookie） | ✅ mp4 + .en.srt |
| M3 帧生成 | ✅ 844 webp + 844 HD jpg，`00_00_00`→`00_14_03` 与时长精确对齐 |
| S2 水印 | ✅ 文件名 = 水印 = 画面时间三方一致；宫格 320×180 格内水印清晰可读 |
| M5 去重（threshold=15） | ✅ 代表帧 443/844 |
| M6 宫格 | ✅ 9 张 grid（3240×920，10×5） |
| M7 半自动停点 | ✅ 生成 prompt.txt（含 315 条字幕）并打印回填指引 |
| M7 JSON 校验 + M8 docx | ✅ 用手工构造的契约 JSON 续跑 `--from article`，产出 360KB docx：6 节标题+居中配图+正文，文末 meta，notes_zh/analysis_zh 未进正文 |
| 全量单测 | ✅ 44 passed |

## 环境实况修正（相对计划）

- `ffmpeg-full` 8.1 因 brew 升级 x265 后 dylib 断链 → `brew upgrade ffmpeg-full` 至 8.1.1 修复；**brew 官方精简版 ffmpeg 8.x 不带 libwebp 编码器**，必须用 ffmpeg-full。
- yt-dlp 2026.06 需要 JS 运行时 + EJS 解算器：`brew install deno` + 依赖 `yt-dlp[default]`（含 `yt-dlp-ejs`，版本锁定，不走运行时远程下载）。**P4 打包需内置 deno 与 yt-dlp-ejs**。
- YouTube 元数据/下载均需 cookie（`--browser chrome` 实测通过；info 请求也要带 cookie，已在 M2 透传）。
- `--sub-langs en.*` 会拉 52 条 en-XX 翻译轨（50+ 次多余请求，风控风险）→ 收窄为 `en,en-orig`。

## 待用户完成 / 后续校准

1. **S1 真实 Gemini 验证**：把 `article/prompt.txt` + `03_grids/` 贴给 Gemini 网页版，检验 JSON 合规率；失败样本记录在此。引擎侧已具备容错解析（剥围栏/截取花括号）与逐字段报错。
2. **自动模式**：设 `GEMINI_API_KEY` 后 `--mode auto` 全程未实测（单测已覆盖请求构造与响应解析）。
3. **阈值校准**：threshold=15 在讲台演讲类视频留 52% 帧，偏多；建议真实使用时试 18–22（`--threshold N` + `--from select` 重跑即可）。
4. Prompt 模板 `prompts/article_prompt.md` 为默认版，可替换为现有生产 Prompt（保留 `{{SUBTITLES}}` 占位符与 JSON 输出要求）。

## 用法速查

```bash
# 半自动（默认）：跑到停点 → 人工回填 article.json → 续跑
uv run python run.py '<url>' --browser chrome
uv run python run.py --task-dir 'workspace/<任务目录>' --from article

# 自动
GEMINI_API_KEY=... uv run python run.py '<url>' --browser chrome --mode auto

# 单步重跑 / 调阈值
uv run python run.py --task-dir 'workspace/<任务目录>' --from select --to grids --threshold 20
```
