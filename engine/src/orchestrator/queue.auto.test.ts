import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
const { startFake, closeAllFakes } = await import("../modules/m7/testFake.ts");
const { SettingsStore } = await import("../store/settings.ts");


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

describe("orchestrator 全自动阶段取消", () => {
  afterEach(closeAllFakes);

  /** 等到任务进入 M7（currentStep=article）且已经发出模型请求。 */
  async function inM7(store: InstanceType<typeof TaskStore>, id: string, until: () => boolean) {
    await vi.waitFor(() => {
      expect(store.get(id)!.currentStep).toBe("article");
      expect(until()).toBe(true);
    });
  }

  it("模型请求进行中取消 → 请求被中止，任务 canceled，无 autoError、无 article", async () => {
    const fake = await startFake(() => "hang");
    let settledWith: unknown;
    state.runArticle = async (_td, deps) => {
      const { client } = deps as { client: { generateArticle(i: unknown): Promise<unknown> } };
      try {
        return await client.generateArticle({ images: [], subtitles: "s", prompt: "p" });
      } catch (e) {
        settledWith = e;
        throw e;
      }
    };
    const { store, orch, id } = setup(new AIConfig({ STILLSCRIBE_AI_BASE_URL: fake.baseUrl }));
    await inM7(store, id, () => fake.requests.length === 1);
    orch.cancel(id);
    await vi.waitFor(() => expect(store.get(id)!.status).toBe("canceled"));
    const task = store.get(id)!;
    expect(task).not.toHaveProperty("autoError");
    expect(task.article).toBeUndefined();
    expect((settledWith as { kind?: string }).kind).toBe("aborted");
    expect(fake.requests).toHaveLength(1);
  });

  it("取消后模型调用仍然返回了结果 → 也落 canceled，不存 article", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered = false;
    state.runArticle = async () => {
      entered = true;
      await gate;
      return { article: ARTICLE, warnings: [] };
    };
    const { store, orch, id } = setup(READY());
    await inM7(store, id, () => entered);
    orch.cancel(id);
    release();
    await vi.waitFor(() => expect(store.get(id)!.status).toBe("canceled"));
    const task = store.get(id)!;
    expect(task).not.toHaveProperty("autoError");
    expect(task.article).toBeUndefined();
  });
});

describe("orchestrator 每个任务现取配置（配置 → 客户端的接缝）", () => {
  afterEach(closeAllFakes);

  it("两个任务之间改了地址 + Key + 记住的级别：各自的请求发往各自地址，带各自的 Key 与起步级别", async () => {
    const fakeA = await startFake(() => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(ARTICLE) } }] } }));
    const fakeB = await startFake(() => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(ARTICLE) } }] } }));
    state.runArticle = async (_td, deps) => {
      const { client } = deps as { client: { generateArticle(i: unknown): Promise<unknown> } };
      const article = await client.generateArticle({ images: [], subtitles: "s", prompt: "p" });
      return { article, warnings: [] };
    };
    const ai = new AIConfig({}, new SettingsStore(":memory:"));
    ai.save({ baseUrl: fakeA.baseUrl, model: "m" });
    ai.setKey({ baseUrl: fakeA.baseUrl, apiKey: "key-a" });

    const store = new TaskStore(":memory:");
    const orch = new Orchestrator(store, new EventBus(), { workRoot: "/tmp", ai });
    const params = { url: "https://x", quality: 1080, dedup: true, mode: "auto" } as const;

    const t1 = orch.submit(params);
    expect((await settled(store, t1.id)).article).toEqual(ARTICLE);

    // 运行中改设置：新地址 + 新 Key，并为（B, m）记住 json_object
    ai.save({ baseUrl: fakeB.baseUrl });
    ai.setKey({ baseUrl: fakeB.baseUrl, apiKey: "key-b" });
    ai.rememberStructuredMode(fakeB.baseUrl, "m", "json_object");

    const t2 = orch.submit(params);
    expect((await settled(store, t2.id)).article).toEqual(ARTICLE);

    expect(fakeA.requests).toHaveLength(1);
    expect(fakeB.requests).toHaveLength(1);
    const [ra] = fakeA.requests;
    const [rb] = fakeB.requests;
    expect(ra!.headers.host).toBe(new URL(fakeA.baseUrl).host);
    expect(ra!.headers.authorization).toBe("Bearer key-a");
    expect(ra!.body.response_format.type).toBe("json_schema");
    expect(rb!.headers.host).toBe(new URL(fakeB.baseUrl).host);
    expect(rb!.headers.authorization).toBe("Bearer key-b");
    expect(rb!.body.response_format).toEqual({ type: "json_object" });
  });
});
