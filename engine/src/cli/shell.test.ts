import { afterEach, describe, expect, it } from "vitest";
import { childEnv, runCmd } from "./shell.ts";

const SECRET_VARS = [
  "STILLSCRIBE_AI_KEYS",
  "STILLSCRIBE_AI_API_KEY",
  "STILLSCRIBE_GEMINI_API_KEY",
  "STILLSCRIBE_TOKEN",
] as const;

describe("childEnv", () => {
  it("去掉模型服务 Key 与引擎令牌，其余原样保留，不改入参", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      HOME: "/home/x",
      STILLSCRIBE_WORK_ROOT: "/w",
      STILLSCRIBE_AI_BASE_URL: "https://a.com/v1",
      STILLSCRIBE_AI_KEYS: '{"https://a.com/v1":"k1"}',
      STILLSCRIBE_AI_API_KEY: "k2",
      STILLSCRIBE_GEMINI_API_KEY: "k3",
      STILLSCRIBE_TOKEN: "tok",
    };
    const out = childEnv(env);
    expect(out).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/x",
      STILLSCRIBE_WORK_ROOT: "/w",
      STILLSCRIBE_AI_BASE_URL: "https://a.com/v1",
    });
    expect(env.STILLSCRIBE_AI_KEYS).toBe('{"https://a.com/v1":"k1"}');
    expect(env.STILLSCRIBE_TOKEN).toBe("tok");
  });
});

describe("runCmd 子进程环境", () => {
  const saved = new Map<string, string | undefined>();
  afterEach(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    saved.clear();
  });

  it("子进程拿不到 Key / 令牌，但拿得到无关变量（如 PATH）", async () => {
    for (const k of [...SECRET_VARS, "STILLSCRIBE_TEST_UNRELATED"]) saved.set(k, process.env[k]);
    for (const k of SECRET_VARS) process.env[k] = `marker-${k}-zz9`;
    process.env.STILLSCRIBE_TEST_UNRELATED = "unrelated-zz9";

    const { stdout } = await runCmd(["/usr/bin/env"]);
    for (const k of SECRET_VARS) expect(stdout).not.toContain(`marker-${k}-zz9`);
    expect(stdout).toContain("unrelated-zz9");
    expect(stdout).toMatch(/^PATH=/m);
    // 父进程自身的变量不被删
    expect(process.env.STILLSCRIBE_AI_KEYS).toBe("marker-STILLSCRIBE_AI_KEYS-zz9");
  });
});
