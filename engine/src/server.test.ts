import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveWithin } from "./server.ts";

const DIR = "/tmp/diggo-task/01_hd";

describe("resolveWithin 路径穿越防护", () => {
  it("允许合法 basename", () => {
    expect(resolveWithin(DIR, "00_01_23.jpg")).toBe(path.join(DIR, "00_01_23.jpg"));
    expect(resolveWithin(DIR, "grid_001.jpg")).toBe(path.join(DIR, "grid_001.jpg"));
  });

  it.each([
    "..",
    ".",
    "../secret",
    "../../etc/passwd",
    "sub/dir.jpg",
    "a\\b.jpg",
    "x\0.jpg",
    "",
  ])("拒绝危险输入: %j", (bad) => {
    expect(resolveWithin(DIR, bad)).toBeNull();
  });
});
