import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { download, fetchVideoInfo } from "./m2-download.ts";

describe("M2 取消透传", () => {
  it("download 收到已 abort 的 signal 立即拒绝，不真正起下载", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "m2dl-"));
    const ac = new AbortController();
    ac.abort();
    // 若 signal 未透传到 runCmd，会真的去 spawn yt-dlp（命中网络/超时/其他错误），
    // 而不是这里期望的"已取消"——这正是 bug 的可断言形态。
    await expect(
      download("https://example.com/whatever", dir, 1080, undefined, undefined, ac.signal),
    ).rejects.toThrow(/取消/);
  });

  it("fetchVideoInfo 收到已 abort 的 signal 立即拒绝", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      fetchVideoInfo("https://example.com/whatever", undefined, undefined, ac.signal),
    ).rejects.toThrow(/取消/);
  });
});
