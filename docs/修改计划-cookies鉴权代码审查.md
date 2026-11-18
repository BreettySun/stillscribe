# 修改计划 — cookies 鉴权改造代码审查整改

> 来源：对提交 `dbec662`（cookies.txt 鉴权改造）的 `/code-review`。
> 范围：3 条经验证的发现。按优先级排序，P0 应在合并/发布前修复。

---

## P0 — `isYouTubeCookie` 域名匹配越界（隐私契约违规）

**文件**：`engine/scripts/refresh-cookies.ts:32`
**类型**：正确性 / 隐私（违反 CLAUDE.md 铁律 6「不把无关站点的 cookie 落盘」）

### 问题
```ts
return domain.replace(/^\./, "").endsWith("youtube.com");
```
`endsWith("youtube.com")` 不带点边界，会把 `fakeyoutube.com`、`myyoutube.com`、`evilyoutube.com`
等**非 YouTube 站点**的 cookie 误判为 YouTube 并写入 `cookies.txt`，违反本文件契约（"只保留 youtube.com 的"）。

### 触发
浏览器里若存在域名 `fakeyoutube.com` 的 cookie → `"fakeyoutube.com".endsWith("youtube.com") === true`
→ 该站点 cookie 被落盘到 `cookies.txt`。

### 修复
精确匹配主域 + 严格子域后缀（先剥离前导点）：
```ts
function isYouTubeCookie(line: string): boolean {
  const raw = line.startsWith(HTTPONLY) ? line.slice(HTTPONLY.length) : line;
  const domain = (raw.split("\t")[0] ?? "").replace(/^\./, "");
  return domain === "youtube.com" || domain.endsWith(".youtube.com");
}
```

### ⚠️ 需先确认的依赖（不要直接合并而漏掉）
yt-dlp 对 YouTube 鉴权**通常也依赖 `.google.com` / `accounts.google.com` 的登录 cookie**。
当前 `filterYouTube` 只保留 `youtube.com`，可能本就丢掉了 Google 账号 cookie 导致鉴权不全。
- 修域名匹配前，先用真实登录的浏览器跑一遍 `refresh-cookies`，确认仅 `youtube.com` cookie
  是否足以过 bot 验证。
- 若不足，白名单应扩为 `{youtube.com, google.com, accounts.google.com}`（仍严格点边界匹配），
  并更新文件头注释与函数名/文档。

### 验收
- 在 `engine/src/modules/`（或脚本旁）加单测：`fakeyoutube.com` 被丢弃；`youtube.com`、
  `.youtube.com`、`www.youtube.com`、`#HttpOnly_.youtube.com` 被保留。
- 决策记录：最终白名单域名清单（写进文件头注释）。

---

## P1 — `STILLSCRIBE_COOKIES_FILE` 只在引擎启动时一次性探测，且无回退

**文件**：`electron/src/main/index.ts:51`（探测点）、`engine/src/modules/m2-download.ts`（消费点）
**类型**：可用性 / 健壮性（altitude）

### 问题
`startEngine` 在 spawn 时 `existsSync(cookiesFile)` 决定是否注入 `STILLSCRIBE_COOKIES_FILE`，**只判一次**。
两种现实路径都坏：
1. **首次使用**：用户先启动 App（此时无 `cookies.txt` → 不注入 → 回退到 `--cookies-from-browser`，
   正是本功能要规避的失败路径），再运行 `pnpm refresh-cookies` 生成 `cookies.txt`。新文件**要等
   App/引擎重启才生效**，且界面无任何提示。
2. **路径已设但文件失效**（空/损坏/被删）：`pushCookieArgs` 仍只推 `--cookies <path>`，yt-dlp 失败，
   **不回退**到浏览器钥匙串。

### 修复（两选一，倾向 A）
- **A（深修，推荐）**：把 cookies 来源判定下沉到引擎、按任务即时探测——
  在 `m2-download` 调用前 `existsSync(cookiesFile)` 再决定传 `--cookies` 还是 `--cookies-from-browser`，
  使「跑完 refresh-cookies 后无需重启」自然成立；文件失效时自动回退浏览器。
- **B（轻修）**：保留启动期探测，但
  - 文档/UI 明确「运行 refresh-cookies 后需重启 App」；
  - `refresh-cookies` 成功后提示用户重启。

### 验收
- 场景 1：启动 App → 运行 refresh-cookies → 不重启即提交任务，鉴权可用（方案 A）或有明确重启提示（方案 B）。
- 场景 2：`cookies.txt` 置空 → 任务能回退浏览器或给出清晰错误，而非静默 bot 失败。

---

## P2 — workRoot 解析与 cookies.txt 路径约定重复（reuse cleanup）

**文件**：`engine/scripts/refresh-cookies.ts:58-61`、`engine/src/serve.ts:13-15`、
`electron/src/main/index.ts:43`
**类型**：可维护性（CLAUDE.md §5「路径常量集中在一个模块管理，不在各处硬编码字符串拼路径」）

### 问题
- `STILLSCRIBE_WORK_ROOT ? resolve(env) : resolve("work")` 在 `serve.ts` 与 `refresh-cookies.ts` 逐字重复。
- `path.join(workRoot, "cookies.txt")` 在 `refresh-cookies.ts` 与 `electron main` 各写一份。
改名/改位置时需多处同步，漏改即静默读/写错位置。

### 修复
在引擎侧路径常量模块（若无则新建 `engine/src/paths.ts`）集中导出：
```ts
export function resolveWorkRoot(env = process.env.STILLSCRIBE_WORK_ROOT): string {
  return env ? path.resolve(env) : path.resolve("work");
}
export const cookiesPath = (workRoot: string) => path.join(workRoot, "cookies.txt");
```
`serve.ts` / `refresh-cookies.ts` 改为调用之；`run.ts` 若有同样逻辑一并收敛。
（electron 主进程不属引擎包，可共用约定常量或在 PR 说明里标注同步点。）

### 验收
- 三处不再各自拼字符串；改一处工作根/文件名，全链路一致。

---

## 执行顺序与契约说明
1. P0 先确认 Google cookie 依赖 → 改域名匹配 + 单测。
2. P1 选定方案（建议 A）→ 改即时探测/回退。
3. P2 收敛路径常量。
4. 本次改动不涉及 `shared/types.ts` 契约变更（仅引擎内 `cookiesFile` 参数线，已在上次提交引入）。
