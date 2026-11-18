import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  runArticle: (async () => undefined) as (...args: unknown[]) => Promise<unknown>,
  calls: 0,
}));

// mock 掉真实流水线：runToGrids 直接 resolve，runArticle 由各用例控制。
vi.mock("./pipeline.ts", () => ({
  runToGrids: vi.fn(async () => ({
    taskDir: {},
    videoId: "vid",
    videoTitle: "标题",
    frames: 0,
    grids: [],
  })),
  // 用普通函数转发而非 vi.fn：vi.fn 记录抛错/rejected 结果时会让用例被判失败。
  runArticle: (...args: unknown[]) => state.runArticle(...args),
  runExport: vi.fn(),
}));

const { Orchestrator } = await import("./queue.ts");
const { EventBus } = await import("./events.ts");
const { TaskStore } = await import("../store/tasks.ts");
const { AIConfig } = await import("../modules/m7/aiConfig.ts");


const ARTICLE = {
  pages: [{ subhead: "Intro", image: "00_00_01", body: "Hello." }],
  meta: { titles: ["T1"], keywords: ["k"], description: "d" },
} as any;

const READY = () => new AIConfig({ STILLSCRIBE_AI_BASE_URL: "http://localhost:1/v1" });

function setup(ai: InstanceType<typeof AIConfig>) {
  const store = new TaskStore(":memory:");
  const orch = new Orchestrator(store, new EventBus(), { workRoot: "/tmp", ai });
  const task = orch.submit({ url: "https://x", quality: 1080, dedup: true, mode: "auto" });
  return { store, orch, id: task.id };
}

async function settled(store: InstanceType<typeof TaskStore>, id: string) {
  await vi.waitFor(() => {
    expect(store.get(id)!.status).toBe("awaiting_review");
  });
  return store.get(id)!;
}

describe("orchestrator 全自动降级原因", () => {
  beforeEach(() => {
    state.calls = 0;
    state.runArticle = async () => {
      state.calls++;
      return undefined;
    };
  });

  it("未就绪 → 任务进入 awaiting_review，autoError 说明未配置 Key", async () => {
    const { store, id } = setup(new AIConfig({}));
    const task = await settled(store, id);
    expect(task.autoError).toMatch(/Key/);
    expect(task.article).toBeUndefined();
    expect(state.calls).toBe(0);
  });

  it("调用失败 → awaiting_review，autoError 为错误原因，任务不失败", async () => {
    state.runArticle = async () => {
      throw new Error("地址或模型名不对");
    };
    const { store, id } = setup(READY());
    const task = await settled(store, id);
    expect(task.status).toBe("awaiting_review");
    expect(task.autoError).toContain("地址或模型名不对");
    expect(task.article).toBeUndefined();
  });

  it("调用成功 → 有 article，无 autoError", async () => {
    state.runArticle = async () => ({ article: ARTICLE, warnings: [] });
    const { store, id } = setup(READY());
    const task = await settled(store, id);
    expect(task.article).toEqual(ARTICLE);
    expect(task).not.toHaveProperty("autoError");
  });

  it("人工回填文章后清掉 autoError", async () => {
    state.runArticle = async () => {
      throw new Error("boom");
    };
    const { store, orch, id } = setup(READY());
    expect((await settled(store, id)).autoError).toContain("boom");
    orch.setArticle(id, ARTICLE);
    expect(store.get(id)).not.toHaveProperty("autoError");
    expect(store.get(id)!.article).toEqual(ARTICLE);
  });
});
