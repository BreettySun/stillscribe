import { describe, it, expect } from "vitest";
import { overallRatio } from "./pipeline.ts";

describe("overallRatio 整体进度折算", () => {
  it("每步落在各自区间起点（无细分）", () => {
    expect(overallRatio("download")).toBe(0);
    expect(overallRatio("frames")).toBe(0.25);
    expect(overallRatio("dedup")).toBe(0.5);
    expect(overallRatio("grids")).toBe(0.75);
  });

  it("步内细分填充该步区间（1/4 跨度）", () => {
    expect(overallRatio("download", 0.5)).toBeCloseTo(0.125);
    expect(overallRatio("download", 1)).toBeCloseTo(0.25);
    expect(overallRatio("frames", 1)).toBeCloseTo(0.5);
  });

  it("sub 越界裁剪到 [0,1]", () => {
    expect(overallRatio("download", -1)).toBe(0);
    expect(overallRatio("download", 5)).toBe(0.25);
  });

  it("非流水线步骤（如 docx）返回 undefined → 走 indeterminate", () => {
    expect(overallRatio("docx")).toBeUndefined();
  });
});
