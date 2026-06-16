import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { phash, hamming } from "./m5-phash.ts";

describe("hamming", () => {
  it("相同为 0、单 bit 差为 1、全反为 64", () => {
    expect(hamming(0n, 0n)).toBe(0);
    expect(hamming(0b1011n, 0b1010n)).toBe(1);
    expect(hamming(0n, (1n << 64n) - 1n)).toBe(64);
  });
});

describe("phash（DCT pHash）", () => {
  it("相同图片距离为 0；纯色 vs 高对比图样距离明显", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "phash-"));
    // 纯灰图
    const flat = path.join(dir, "flat.png");
    await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 128, g: 128, b: 128 } } })
      .png().toFile(flat);
    // 左黑右白的高对比图（低频能量强，pHash 与纯色应明显不同）
    const half = path.join(dir, "half.png");
    const raw = Buffer.alloc(64 * 64 * 3);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const v = x < 32 ? 0 : 255;
        const i = (y * 64 + x) * 3;
        raw[i] = raw[i + 1] = raw[i + 2] = v;
      }
    await sharp(raw, { raw: { width: 64, height: 64, channels: 3 } }).png().toFile(half);

    const hFlat1 = await phash(flat);
    const hFlat2 = await phash(flat);
    const hHalf = await phash(half);

    expect(hamming(hFlat1, hFlat2)).toBe(0); // 同图同哈希
    expect(hamming(hFlat1, hHalf)).toBeGreaterThan(5); // 明显不同
  });
});

describe("selectRepresentatives（基于真实 phash 的去重语义）", () => {
  it("threshold=0 保留全部；超大阈值收敛到 1", async () => {
    const { selectRepresentatives } = await import("./m5-select.ts");
    const dir = await mkdtemp(path.join(tmpdir(), "select-"));
    // 造 3 帧：两帧纯色相近、一帧迥异（文件名须为 HH_MM_SS）
    const mk = async (name: string, shade: number) => {
      const buf = await sharp({
        create: { width: 32, height: 32, channels: 3, background: { r: shade, g: shade, b: shade } },
      }).webp().toBuffer();
      await writeFile(path.join(dir, `${name}.webp`), buf);
    };
    await mk("00_00_00", 128);
    await mk("00_00_01", 130); // 与上一帧极近
    await mk("00_00_02", 128);

    const all = await selectRepresentatives(dir, 0);
    expect(all).toEqual(["00_00_00", "00_00_01", "00_00_02"]); // 全保留、按时间序

    const one = await selectRepresentatives(dir, 65); // 超过 64 位上限 → 不可能满足 → 只留首帧
    expect(one).toEqual(["00_00_00"]);
  });
});
