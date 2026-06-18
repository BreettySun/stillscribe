import { describe, it, expect, vi } from "vitest";
import type { EngineEvent } from "@shared/types";

// mock 掉真实流水线：runToGrids 只触发 onInfo 再 resolve，不去 spawn yt-dlp。
vi.mock("./pipeline.ts", () => ({
  runToGrids: vi.fn(async (_params: unknown, hooks: any) => {
    await hooks.onInfo?.({ workDir: "/tmp/wd", videoTitle: "我的视频标题" });
    return { taskDir: {}, videoId: "vid", videoTitle: "我的视频标题", frames: 0, grids: [] };
  }),
  runDocx: vi.fn(),
}));

const { Orchestrator } = await import("./queue.ts");
const { EventBus } = await import("./events.ts");
const { TaskStore } = await import("../store/tasks.ts");

describe("orchestrator 视频信息事件", () => {
  it("拿到视频信息后立即广播 info 事件（含 videoTitle），无需等下一次交互", async () => {
    const store = new TaskStore(":memory:");
    const bus = new EventBus();
    const events: EngineEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const orch = new Orchestrator(store, bus, { workRoot: "/tmp" });
    orch.submit({ url: "https://x", quality: 1080, dedup: true, mode: "semi" });

    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "info")).toBe(true);
    });
    const info = events.find((e) => e.type === "info");
    expect(info).toMatchObject({ type: "info", videoTitle: "我的视频标题", workDir: "/tmp/wd" });
  });
});
