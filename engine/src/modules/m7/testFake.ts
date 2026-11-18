import http from "node:http";
import type { AddressInfo } from "node:net";

export interface Recorded {
  url: string;
  headers: http.IncomingHttpHeaders;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}
export interface FakeReply {
  status: number;
  json?: unknown;
  text?: string;
}
export type Handler = (req: Recorded, index: number) => FakeReply | "hang";

export const ok = (content: string) => ({ status: 200, json: { choices: [{ message: { content } }] } });

const fakes: Array<{ close: () => Promise<void> }> = [];

/** 本地假服务：记录每个请求，由 handler 决定响应 */
export async function startFake(handler: Handler) {
  const requests: Recorded[] = [];
  const sockets = new Set<import("node:net").Socket>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const rec: Recorded = { url: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      requests.push(rec);
      const reply = handler(rec, requests.length - 1);
      if (reply === "hang") return;
      const payload = reply.text ?? JSON.stringify(reply.json ?? {});
      res.writeHead(reply.status, { "content-type": reply.text !== undefined ? "text/html" : "application/json" });
      res.end(payload);
    });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fake = {
    baseUrl,
    requests,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
  fakes.push(fake);
  return fake;
}

export async function closeAllFakes(): Promise<void> {
  await Promise.all(fakes.splice(0).map((f) => f.close()));
}
