import { describe, it, expect } from "vitest";
import { repairImageTimestamp } from "./timestamps.ts";

/** 帧集合：00_00_00 … 00_02_51（一段 2 分 51 秒的视频，逐秒一帧）。 */
function frames(totalSeconds: number): Set<string> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const out = new Set<string>();
  for (let t = 0; t <= totalSeconds; t++) {
    out.add(`${pad(Math.floor(t / 3600))}_${pad(Math.floor((t % 3600) / 60))}_${pad(t % 60)}`);
  }
  return out;
}

const SHORT = frames(171); // 到 00_02_51

describe("repairImageTimestamp 配图时间戳纠正", () => {
  it("已经合法的值原样返回", () => {
    expect(repairImageTimestamp("00_01_40", SHORT)).toBe("00_01_40");
  });

  // 实测（2026-11-18，gemini-2.5-flash，兼容接口与原生接口都出现）：
  // 水印是 00:01:40.000，模型却按"分_秒_毫秒"写成三段。
  it.each([
    ["01_40_000", "00_01_40"],
    ["01_40_00", "00_01_40"],
    ["00_46_000", "00_00_46"],
    ["02_51_000", "00_02_51"],
    ["00_23_00", "00_00_23"],
  ])("把 分_秒_毫秒 %j 还原为 %j", (input, want) => {
    expect(repairImageTimestamp(input, SHORT)).toBe(want);
  });

  it.each([
    ["00:01:40.000", "00_01_40"], // 逐字抄了水印
    ["00_01_40_000", "00_01_40"], // 四段都留着
    ["00:01:40", "00_01_40"], // 没把冒号换成下划线
    ["00_01_40.jpg", "00_01_40"], // 带了后缀
    [" 00_01_40 ", "00_01_40"],
    ["0_1_40", "00_01_40"], // 没补零
    ["01:40", "00_01_40"], // 只有 分:秒
  ])("其他常见写法 %j 还原为 %j", (input, want) => {
    expect(repairImageTimestamp(input, SHORT)).toBe(want);
  });

  it.each(["09_09_09", "03_10_00", "00_99_00", "", "abc", "12", "1_2_3_4_5"])(
    "还原不出存在的帧时返回 null：%j",
    (input) => {
      expect(repairImageTimestamp(input, SHORT)).toBeNull();
    },
  );

  it("只在原值不是合法帧时才纠正：长视频里 01_40_00 本身就是一帧，不动它", () => {
    const LONG = frames(2 * 3600); // 到 02_00_00
    expect(repairImageTimestamp("01_40_00", LONG)).toBe("01_40_00");
  });

  it("绝不返回帧集合之外的值", () => {
    const tiny = new Set(["00_00_00", "00_00_02"]);
    expect(repairImageTimestamp("00_01_000", tiny)).toBeNull(); // 00_00_01 不在集合里
    expect(repairImageTimestamp("00_02_000", tiny)).toBe("00_00_02");
  });
});
