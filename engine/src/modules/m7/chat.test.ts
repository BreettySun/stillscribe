import { describe, it, expect, afterEach } from "vitest";
import { startFake, closeAllFakes, ok, type FakeReply } from "./testFake.ts";
import { chatJson, chatText, AIRequestError, type ChatPart } from "./chat.ts";

const SCHEMA = { name: "t", schema: { type: "object" } };
const PARTS: ChatPart[] = [
  { type: "text", text: "p" },
  { type: "image", base64: "QUJD", mimeType: "image/png" },
];

afterEach(closeAllFakes);

async function catchErr(p: Promise<unknown>): Promise<AIRequestError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AIRequestError);
    return e as AIRequestError;
  }
  throw new Error("预期抛错但成功了");
}

describe("chat 客户端", () => {
  it("请求形状：路径、Key 只在请求头、图片为 data URL", async () => {
    const fake = await startFake(() => ok("{}"));
    await chatJson({ baseUrl: fake.baseUrl, apiKey: "sk-test", model: "m" }, { parts: PARTS, schema: SCHEMA });
    const req = fake.requests[0]!;
    expect(req.url).toBe("/chat/completions");
    expect(req.headers.authorization).toBe("Bearer sk-test");
    expect(req.url).not.toContain("sk-test");
    expect(req.body.model).toBe("m");
    expect(req.body.messages[0].role).toBe("user");
    expect(req.body.messages[0].content[0]).toEqual({ type: "text", text: "p" });
    expect(req.body.messages[0].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,QUJD" },
    });
    expect(req.body.response_format.type).toBe("json_schema");
    expect(req.body.response_format.json_schema.name).toBe("t");
    expect(req.body.response_format.json_schema.strict).toBeUndefined();
  });

  it("baseUrl 末尾带斜杠也能拼出正确路径", async () => {
    const fake = await startFake(() => ok("{}"));
    await chatJson({ baseUrl: fake.baseUrl + "/", model: "m" }, { parts: PARTS, schema: SCHEMA });
    expect(fake.requests[0]!.url).toBe("/chat/completions");
  });

  it("没有 Key 时不带 Authorization 请求头", async () => {
    const fake = await startFake(() => ok("{}"));
    await chatJson({ baseUrl: fake.baseUrl, model: "m" }, { parts: PARTS, schema: SCHEMA });
    expect(fake.requests[0]!.headers.authorization).toBeUndefined();
  });

  it("json_schema 被 400 拒绝 → 降到 json_object 并成功", async () => {
    const fake = await startFake((req) =>
      req.body.response_format?.type === "json_schema"
        ? { status: 400, json: { error: { message: "response_format not supported" } } }
        : ok("{}"),
    );
    const result = await chatJson({ baseUrl: fake.baseUrl, model: "m" }, { parts: PARTS, schema: SCHEMA });
    expect(result.mode).toBe("json_object");
    expect(result.content).toBe("{}");
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1]!.body.response_format).toEqual({ type: "json_object" });
  });

  it("三级都被拒绝 → 抛出第一次的错误原文", async () => {
    const msgs = ["first", "second", "third"];
    const fake = await startFake((_r, i) => ({ status: 400, json: { error: { message: msgs[i] } } }));
    const err = await catchErr(chatJson({ baseUrl: fake.baseUrl, model: "m" }, { parts: PARTS, schema: SCHEMA }));
    expect(err.kind).toBe("rejected");
    expect(err.message).toContain("first");
    expect(err.message).not.toContain("second");
    expect(fake.requests).toHaveLength(3);
    expect(fake.requests[2]!.body.response_format).toBeUndefined();
  });

  it("startMode=none 时只发一次且不带 response_format", async () => {
    const fake = await startFake(() => ok("{}"));
    const result = await chatJson(
      { baseUrl: fake.baseUrl, model: "m" },
      { parts: PARTS, schema: SCHEMA, startMode: "none" },
    );
    expect(result.mode).toBe("none");
    expect(fake.requests).toHaveLength(1);
    expect("response_format" in fake.requests[0]!.body).toBe(false);
  });

  it("startMode=json_object 起步，被拒绝只降到 none", async () => {
    const fake = await startFake((req) =>
      req.body.response_format ? { status: 400, json: { error: { message: "no" } } } : ok("{}"),
    );
    const result = await chatJson(
      { baseUrl: fake.baseUrl, model: "m" },
      { parts: PARTS, schema: SCHEMA, startMode: "json_object" },
    );
    expect(result.mode).toBe("none");
    expect(fake.requests).toHaveLength(2);
  });

  it.each([
    [401, "config"],
    [403, "config"],
    [404, "not_found"],
    [429, "rate_limit"],
    [500, "server"],
  ])("HTTP %i → kind %s，且不降级", async (status, kind) => {
    const fake = await startFake(() => ({ status, json: { error: { message: "boom" } } }));
    const err = await catchErr(chatJson({ baseUrl: fake.baseUrl, apiKey: "sk-test", model: "m" }, { parts: PARTS, schema: SCHEMA }));
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
    expect(fake.requests).toHaveLength(1);
    expect(err.message).not.toContain("sk-test");
  });

  it("Gemini 兼容层的无效 Key：400 + 数组外形 → config，不降级", async () => {
    const fake = await startFake(() => ({
      status: 400,
      json: [{ error: { code: 400, message: "Please pass a valid API key", status: "INVALID_ARGUMENT" } }],
    }));
    const err = await catchErr(chatJson({ baseUrl: fake.baseUrl, apiKey: "sk-test", model: "m" }, { parts: PARTS, schema: SCHEMA }));
    expect(err.kind).toBe("config");
    expect(fake.requests).toHaveLength(1);
  });

  it("400 数组外形的普通拒绝：rejected 且信息含服务端原文", async () => {
    const fake = await startFake(() => ({
      status: 400,
      json: [{ error: { code: 400, message: "bad schema thing", status: "INVALID_ARGUMENT" } }],
    }));
    const err = await catchErr(
      chatJson({ baseUrl: fake.baseUrl, model: "m" }, { parts: PARTS, schema: SCHEMA, startMode: "none" }),
    );
    expect(err.kind).toBe("rejected");
    expect(err.message).toContain("bad schema thing");
  });

  it("400 取不到 error.message → 用响应文本前 300 字符", async () => {
    const long = "x".repeat(500);
    const fake = await startFake(() => ({ status: 400, text: long }));
    const err = await catchErr(
      chatJson({ baseUrl: fake.baseUrl, model: "m" }, { parts: PARTS, schema: SCHEMA, startMode: "none" }),
    );
    expect(err.kind).toBe("rejected");
    expect(err.message).toContain("x".repeat(300));
    expect(err.message).not.toContain("x".repeat(301));
  });

  it("200 但 choices 为空 / content 为 null → empty", async () => {
    for (const json of [{ choices: [] }, { choices: [{ message: { content: null } }] }]) {
      const fake = await startFake(() => ({ status: 200, json }));
      const err = await catchErr(chatJson({ baseUrl: fake.baseUrl, model: "m" }, { parts: PARTS, schema: SCHEMA }));
      expect(err.kind).toBe("empty");
      expect(fake.requests).toHaveLength(1);
    }
  });

  it("200 但响应是 HTML → not_found", async () => {
    const fake = await startFake(() => ({ status: 200, text: "<html>login</html>" }));
    const err = await catchErr(chatJson({ baseUrl: fake.baseUrl, model: "m" }, { parts: PARTS, schema: SCHEMA }));
    expect(err.kind).toBe("not_found");
    expect(fake.requests).toHaveLength(1);
  });

  it("Key 含非 ASCII → config，信息里不含 Key，且不发请求", async () => {
    const fake = await startFake(() => ok("{}"));
    const err = await catchErr(
      chatJson({ baseUrl: fake.baseUrl, apiKey: "密钥abc", model: "m" }, { parts: PARTS, schema: SCHEMA }),
    );
    expect(err.kind).toBe("config");
    expect(err.message).not.toContain("密钥abc");
    expect(fake.requests).toHaveLength(0);
  });

  it("连不上 → network", async () => {
    const dead = await startFake(() => ok("{}"));
    const baseUrl = dead.baseUrl;
    await dead.close();
    const err = await catchErr(chatJson({ baseUrl, apiKey: "sk-test", model: "m" }, { parts: PARTS, schema: SCHEMA }));
    expect(err.kind).toBe("network");
    expect(err.message).not.toContain("sk-test");
  });

  it("超时 → network", async () => {
    const fake = await startFake(() => "hang");
    const err = await catchErr(
      chatJson({ baseUrl: fake.baseUrl, apiKey: "sk-test", model: "m", timeoutMs: 50 }, { parts: PARTS, schema: SCHEMA }),
    );
    expect(err.kind).toBe("network");
    expect(err.message).not.toContain("sk-test");
    expect(fake.requests).toHaveLength(1);
  });

  it("所有错误信息都不含 Key（服务端回显 Key 也要抹掉）", async () => {
    const cases: FakeReply[] = [
      { status: 401, json: { error: { message: "bad key sk-test" } } },
      { status: 404, text: "not found sk-test" },
      { status: 429, json: { error: { message: "limit sk-test" } } },
      { status: 400, json: { error: { message: "echo sk-test" } } },
      { status: 500, text: "oops sk-test" },
      { status: 200, text: "<html>sk-test</html>" },
      { status: 200, json: { choices: [] } },
    ];
    for (const reply of cases) {
      const fake = await startFake(() => reply);
      const err = await catchErr(
        chatJson({ baseUrl: fake.baseUrl, apiKey: "sk-test", model: "m" }, { parts: PARTS, schema: SCHEMA, startMode: "none" }),
      );
      expect(err.message).not.toContain("sk-test");
    }
  });

  it("chatText 不带 response_format 并返回文本", async () => {
    const fake = await startFake(() => ok("pong"));
    const text = await chatText({ baseUrl: fake.baseUrl, apiKey: "sk-test", model: "m" }, [{ type: "text", text: "ping" }]);
    expect(text).toBe("pong");
    expect(fake.requests).toHaveLength(1);
    expect("response_format" in fake.requests[0]!.body).toBe(false);
    expect(fake.requests[0]!.headers.authorization).toBe("Bearer sk-test");
  });
});
