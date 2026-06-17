/**
 * 引擎服务进程入口（P2）。装配 store/bus/orchestrator + Fastify，绑定 127.0.0.1。
 * 环境变量：DIGGO_WORK_ROOT（工作根，默认 ./work）、DIGGO_PORT（默认 8787）、
 *           DIGGO_HOST（默认 127.0.0.1）、DIGGO_BROWSER（yt-dlp --cookies-from-browser）。
 * cookies.txt 不在此注入——编排器按任务即时探测 <workRoot>/cookies.txt（P1 方案 A）。
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveWorkRoot } from "./paths.ts";
import { TaskStore } from "./store/tasks.ts";
import { EventBus } from "./orchestrator/events.ts";
import { Orchestrator } from "./orchestrator/queue.ts";
import { buildServer } from "./server.ts";

const workRoot = resolveWorkRoot();
const host = process.env.DIGGO_HOST ?? "127.0.0.1";
const port = Number(process.env.DIGGO_PORT ?? 8787);
const browser = process.env.DIGGO_BROWSER || undefined;

mkdirSync(workRoot, { recursive: true });

const store = new TaskStore(path.join(workRoot, "tasks.db"));
const bus = new EventBus();
const orchestrator = new Orchestrator(store, bus, {
  workRoot,
  ...(browser ? { browser } : {}),
});
const app = buildServer({ store, bus, orchestrator });

orchestrator.recover();

app
  .listen({ host, port })
  .then(() => {
    process.stderr.write(`✅ 引擎已启动: http://${host}:${port}  (workRoot=${workRoot})\n`);
  })
  .catch((err: unknown) => {
    process.stderr.write(`❌ 启动失败: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    app.close().finally(() => {
      store.close();
      process.exit(0);
    });
  });
}
