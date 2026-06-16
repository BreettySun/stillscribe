/**
 * 感知哈希（DCT pHash, 64 位）。M5 去重专用。
 * 铁律 #2：sharp 仅用于解码 + 缩放 + 灰度取像素来算 phash，绝不用它再编码出图。
 *
 * 算法（与 Python imagehash.phash 默认 hash_size=8 语义一致）：
 *   解码 → 32×32 灰度 raw → DCT-II（二维，可分离）→ 取左上 8×8（去 DC 项）
 *   → 以这 63 个系数（含 DC 位但用中位数阈值时排除）的中位数为阈值 → 64 位。
 */
import sharp from "sharp";

const SIZE = 32; // DCT 输入边长
const HASH = 8; // 取左上 8×8 低频系数 → 64 位

/** 预计算 DCT-II 余弦系数矩阵：cos[k][n] = cos(π/N · (n+0.5) · k)。 */
function dctMatrix(n: number): number[][] {
  const m: number[][] = [];
  for (let k = 0; k < n; k++) {
    const row = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      row[i] = Math.cos((Math.PI / n) * (i + 0.5) * k);
    }
    m.push(row);
  }
  return m;
}

const COS = dctMatrix(SIZE);

/** 对 SIZE×SIZE 灰度矩阵做二维 DCT-II，仅返回左上 HASH×HASH 低频块。 */
function dct2LowFreq(pixels: Float64Array): number[] {
  // 先按行做 1D DCT，只保留前 HASH 列；再按列做 1D DCT，只保留前 HASH 行。
  const rowDct = new Float64Array(SIZE * HASH);
  for (let y = 0; y < SIZE; y++) {
    for (let u = 0; u < HASH; u++) {
      let sum = 0;
      const cosU = COS[u]!;
      for (let x = 0; x < SIZE; x++) sum += pixels[y * SIZE + x]! * cosU[x]!;
      rowDct[y * HASH + u] = sum;
    }
  }
  const out: number[] = new Array(HASH * HASH);
  for (let u = 0; u < HASH; u++) {
    for (let v = 0; v < HASH; v++) {
      let sum = 0;
      const cosV = COS[v]!;
      for (let y = 0; y < SIZE; y++) sum += rowDct[y * HASH + u]! * cosV[y]!;
      out[v * HASH + u] = sum;
    }
  }
  return out;
}

/** 由 64 个低频系数生成 64 位哈希：排除 DC 项后取中位数为阈值。 */
function coeffsToHash(coeffs: number[]): bigint {
  // coeffs[0] 是 DC（最大能量），算中位数时排除它，避免偏置。
  const rest = coeffs.slice(1).sort((a, b) => a - b);
  const median = rest[Math.floor(rest.length / 2)]!;
  let h = 0n;
  for (let i = 0; i < coeffs.length; i++) {
    h <<= 1n;
    if (coeffs[i]! > median) h |= 1n;
  }
  return h;
}

/** 计算图片的 64 位 pHash。 */
export async function phash(imagePath: string): Promise<bigint> {
  const { data } = await sharp(imagePath)
    .resize(SIZE, SIZE, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Float64Array(SIZE * SIZE);
  for (let i = 0; i < pixels.length; i++) pixels[i] = data[i]!;
  return coeffsToHash(dct2LowFreq(pixels));
}

/** 两个 64 位哈希的汉明距离（不同位的个数，0..64）。 */
export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
