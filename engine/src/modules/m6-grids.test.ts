import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DIGGO_FFMPEG = process.execPath; // toolPath 存在性校验解耦
});

const { chunkFrames, gridName, buildGridArgs } = await import("./m6-grids.ts");

const names = (n: number) =>
  Array.from({ length: n }, (_, i) => `00_00_${String(i).padStart(2, "0")}`);

describe("chunkFrames（每组 50）", () => {
  it("120 帧 → 3 组 (50/50/20)", () => {
    const chunks = chunkFrames(names(120));
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 20]);
  });
  it("空、恰好 50、51", () => {
    expect(chunkFrames([])).toEqual([]);
    expect(chunkFrames(names(50)).length).toBe(1);
    expect(chunkFrames(names(51)).map((c) => c.length)).toEqual([50, 1]);
  });
});

describe("gridName", () => {
  it("零填充 3 位、1-based", () => {
    expect(gridName(0)).toBe("grid_001.jpg");
    expect(gridName(9)).toBe("grid_010.jpg");
  });
});

describe("buildGridArgs（ffmpeg tile）", () => {
  it("framerate/输入序列/scale+tile/单帧/输出", () => {
    const a = buildGridArgs("/tmp/seq", "/t/03_grids/grid_001.jpg");
    expect(a[0]).toBe(process.execPath);
    expect(a).toEqual(expect.arrayContaining(["-y", "-framerate", "1", "-frames:v", "1"]));
    expect(a[a.indexOf("-i") + 1]).toBe("/tmp/seq/%05d.webp");
    expect(a[a.indexOf("-vf") + 1]).toBe("scale=320:180,tile=10x5:padding=2:color=black");
    expect(a.at(-1)).toBe("/t/03_grids/grid_001.jpg");
  });
});
