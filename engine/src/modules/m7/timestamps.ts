/**
 * 配图时间戳纠正：模型给的 image 不是合法帧时，按水印的常见写法尝试还原。
 *
 * 【为什么需要】帧上的水印是 ffmpeg `%{pts:hms}` 画的 `HH:MM:SS.mmm`（四段数字，见 m3-frames.ts），
 * 而契约要的是 `HH_MM_SS`（三段）。模型能正确读出水印，但转换时常取错三段：
 * 把 `00:01:40.000` 写成 `01_40_000` / `01_40_00`（分_秒_毫秒）。实测 2026-11-18（gemini-2.5-flash）
 * 兼容接口与原生接口都会出现，同一视频多数轮次整篇都是这种写法；在提示词里追加转换说明也压不住。
 * 这种错写是可逆的：还原后几乎全部落在喂给模型的代表帧上，所以在这里做确定性纠正。
 *
 * 【边界】只在原值不在帧集合内时才动它；候选值必须确实是存在的帧才采用，绝不凭空造一个时间戳。
 * 还原不出来就返回 null，由调用方照旧标记"待人工换图"。
 */

/** 帧时间戳两位补零：`"1"` → `"01"`。超过两位的原样返回（必然不是合法帧，候选自然落空）。 */
function pad2(group: string): string {
  return group.padStart(2, "0");
}

function join(h: string, m: string, s: string): string {
  return `${pad2(h)}_${pad2(m)}_${pad2(s)}`;
}

/**
 * @param image 模型给的 image 值
 * @param valid 本任务全部合法帧时间戳（`HH_MM_SS`）
 * @returns 合法帧时间戳；原值本身合法则原样返回；还原不出存在的帧则 null
 */
export function repairImageTimestamp(image: string, valid: ReadonlySet<string>): string | null {
  const raw = image.trim();
  if (valid.has(raw)) return raw;

  // 去掉可能带上的图片后缀，再按"非数字"切成数字段：冒号、点、下划线一视同仁。
  const groups = raw
    .replace(/\.(jpe?g|png|webp)$/i, "")
    .split(/\D+/)
    .filter((g) => g !== "");

  const candidates: string[] = [];
  if (groups.length === 4) {
    // 时:分:秒.毫秒 —— 逐字抄了水印，丢掉毫秒。
    candidates.push(join(groups[0]!, groups[1]!, groups[2]!));
  } else if (groups.length === 3) {
    // 先当作 时_分_秒（只是分隔符或补零不对）；
    candidates.push(join(groups[0]!, groups[1]!, groups[2]!));
    // 再当作 分_秒_毫秒（丢了小时、把毫秒当成第三段）。
    candidates.push(join("0", groups[0]!, groups[1]!));
  } else if (groups.length === 2) {
    // 分:秒
    candidates.push(join("0", groups[0]!, groups[1]!));
  }

  return candidates.find((c) => valid.has(c)) ?? null;
}
