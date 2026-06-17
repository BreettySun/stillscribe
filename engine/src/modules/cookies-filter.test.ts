import { describe, it, expect } from "vitest";
import { isYouTubeCookie, filterYouTube } from "./cookies-filter.ts";

const cookie = (domain: string) => `${domain}\tTRUE\t/\tTRUE\t0\tSID\tabc`;

describe("isYouTubeCookie 域名边界（不越界匹配仿冒站点）", () => {
  it("保留 youtube.com 主域与子域", () => {
    expect(isYouTubeCookie(cookie("youtube.com"))).toBe(true);
    expect(isYouTubeCookie(cookie(".youtube.com"))).toBe(true);
    expect(isYouTubeCookie(cookie("www.youtube.com"))).toBe(true);
    expect(isYouTubeCookie(`#HttpOnly_${cookie(".youtube.com")}`)).toBe(true);
  });

  it("丢弃仿冒/无关站点（这是 P0 的核心：endsWith 会误判）", () => {
    expect(isYouTubeCookie(cookie("fakeyoutube.com"))).toBe(false);
    expect(isYouTubeCookie(cookie("myyoutube.com"))).toBe(false);
    expect(isYouTubeCookie(cookie("evilyoutube.com"))).toBe(false);
    expect(isYouTubeCookie(cookie("youtube.com.evil.com"))).toBe(false);
    expect(isYouTubeCookie(cookie("google.com"))).toBe(false);
  });
});

describe("filterYouTube", () => {
  it("保留头注释 + youtube.com cookie，丢弃 fakeyoutube.com，计数正确", () => {
    const input = [
      "# Netscape HTTP Cookie File",
      cookie("youtube.com"),
      cookie("fakeyoutube.com"),
      `#HttpOnly_${cookie(".youtube.com")}`,
      cookie(".google.com"),
      "",
    ].join("\n");
    const { out, kept } = filterYouTube(input);
    expect(kept).toBe(2);
    expect(out).toContain("# Netscape HTTP Cookie File");
    expect(out).toContain("youtube.com");
    expect(out).not.toContain("fakeyoutube.com");
    expect(out).not.toContain("google.com");
    expect(out.endsWith("\n")).toBe(true);
  });
});
