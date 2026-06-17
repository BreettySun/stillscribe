/**
 * Netscape cookies.txt 过滤 —— 只保留 youtube.com（含子域）的 cookie，丢弃其他站点。
 * 由 refresh-cookies 脚本调用；抽成纯函数便于单测（不触发脚本副作用）。
 *
 * 白名单：youtube.com 主域 + *.youtube.com 子域，严格点边界匹配。
 * 不用 endsWith("youtube.com")——那会把 fakeyoutube.com / evilyoutube.com 误判为 YouTube
 * 而落盘其 cookie，违反 CLAUDE.md 铁律 6（不把无关站点 cookie 落盘）。
 */
const HTTPONLY = "#HttpOnly_";

/** 某行是不是 youtube.com（含子域）的 cookie（兼容 #HttpOnly_ 前缀与前导点域名）。 */
export function isYouTubeCookie(line: string): boolean {
  const raw = line.startsWith(HTTPONLY) ? line.slice(HTTPONLY.length) : line;
  const domain = (raw.split("\t")[0] ?? "").replace(/^\./, "");
  return domain === "youtube.com" || domain.endsWith(".youtube.com");
}

/** 保留 Netscape 头注释 + youtube.com 的 cookie（含 HttpOnly），丢弃其他站点。 */
export function filterYouTube(text: string): { out: string; kept: number } {
  const lines: string[] = [];
  let kept = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    // 真注释/头（# 开头但不是 #HttpOnly_ 这种伪注释 cookie）原样保留。
    if (line.startsWith("#") && !line.startsWith(HTTPONLY)) {
      lines.push(line);
      continue;
    }
    if (isYouTubeCookie(line)) {
      lines.push(line);
      kept++;
    }
  }
  return { out: lines.join("\n") + "\n", kept };
}
