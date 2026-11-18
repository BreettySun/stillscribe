import { describe, it, expect, afterEach } from "vitest";
import { startFake, closeAllFakes, ok } from "./testFake.ts";
import { createArticleClient } from "./articleClient.ts";
import { articleJsonSchema } from "./schema.ts";
import type { AIStructuredMode } from "@shared/types";

const ARTICLE = {
  pages: [{ subhead: "s", image: "00_00_01", body: "b" }],
  meta: { titles: ["t"], keywords: ["k"], description: "d" },
};
const INPUT = {
  prompt: "PROMPT",
  subtitles: "SUBS",
  images: [{ base64: "QUJD", mimeType: "image/png" }],
};

afterEach(closeAllFakes);

describe("createArticleClient", () => {
  it("按 提示词→字幕→图片 的顺序发送，并返回校验过的 Article", async () => {
    const fake = await startFake(() => ok(JSON.stringify(ARTICLE)));
    const client = createArticleClient({ baseUrl: fake.baseUrl, model: "m" });
    const article = await client.generateArticle(INPUT);
    const content = fake.requests[0]!.body.messages[0].content;
    expect(content[0].text).toBe("PROMPT");
    expect(content[1].text).toBe("SUBS");
    expect(content[2].type).toBe("image_url");
    expect(article).toEqual(ARTICLE);
  });

  it("把 Article 的 JSON Schema 以 name=article 传给服务端", async () => {
    const fake = await startFake(() => ok(JSON.stringify(ARTICLE)));
    await createArticleClient({ baseUrl: fake.baseUrl, model: "m" }).generateArticle(INPUT);
    const req = fake.requests[0]!;
    expect(req.body.response_format.json_schema.name).toBe("article");
    expect(req.body.response_format.json_schema.schema).toEqual(articleJsonSchema);
  });

  it("成功后经 onStructuredMode 回报实际级别", async () => {
    const fake = await startFake((req) =>
      req.body.response_format?.type === "json_schema"
        ? { status: 400, json: { error: { message: "response_format not supported" } } }
        : ok(JSON.stringify(ARTICLE)),
    );
    const modes: AIStructuredMode[] = [];
    const client = createArticleClient({
      baseUrl: fake.baseUrl,
      model: "m",
      onStructuredMode: (m) => modes.push(m),
    });
    await client.generateArticle(INPUT);
    expect(modes).toEqual(["json_object"]);
  });

  it("从 structuredMode 指定的级别开始", async () => {
    const fake = await startFake(() => ok(JSON.stringify(ARTICLE)));
    const client = createArticleClient({ baseUrl: fake.baseUrl, model: "m", structuredMode: "json_object" });
    await client.generateArticle(INPUT);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]!.body.response_format).toEqual({ type: "json_object" });
  });

  it("内容不是合法 Article → 抛错", async () => {
    const fake = await startFake(() => ok('{"pages":[]}'));
    const client = createArticleClient({ baseUrl: fake.baseUrl, model: "m" });
    await expect(client.generateArticle(INPUT)).rejects.toThrow();
  });

  it("内容包在 ```json 围栏里也能解析", async () => {
    const fake = await startFake(() => ok("```json\n" + JSON.stringify(ARTICLE) + "\n```"));
    const client = createArticleClient({ baseUrl: fake.baseUrl, model: "m" });
    expect(await client.generateArticle(INPUT)).toEqual(ARTICLE);
  });
});
