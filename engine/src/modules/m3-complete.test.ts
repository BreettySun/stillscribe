import { describe, it, expect } from "vitest";
import { isCompletePass } from "./m3-frames.ts";

describe("isCompletePass 抽帧完整性判断", () => {
  it("全部 HH_MM_SS 命名 → 完成", () => {
    expect(isCompletePass(["00_00_00", "00_00_01", "00_01_23"])).toBe(true);
  });

  it("仅数字名残片（中断、改名前被杀）→ 未完成", () => {
    expect(isCompletePass(["5", "6", "7"])).toBe(false);
  });

  it("HH_MM_SS 与数字名混存（重跑中途被杀）→ 未完成", () => {
    expect(isCompletePass(["00_00_00", "00_00_01", "5"])).toBe(false);
  });

  it("空目录 → 未完成", () => {
    expect(isCompletePass([])).toBe(false);
  });
});
