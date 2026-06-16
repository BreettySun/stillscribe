/**
 * 外部进程调用封装：用 spawn（参数数组，非 shell 字符串，杜绝注入），
 * 统一回显命令、超时、失败时抛出带 stderr 尾部的错误。
 */
import { spawn } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** 超时（毫秒）；省略则不限时。 */
  timeoutMs?: number;
  /** 取消信号；abort 时 SIGKILL 子进程并 reject。 */
  signal?: AbortSignal;
}

/**
 * 运行命令。args[0] 必须是可执行文件的绝对路径（见 cli/tools.ts）。
 * 退出码非 0 抛出 Error（含 stderr 尾部 20 行）。
 */
export function runCmd(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const [cmd, ...rest] = args;
  if (!cmd) throw new Error("runCmd: 空命令");
  if (opts.signal?.aborted) {
    return Promise.reject(new Error(`命令已取消: ${cmd}`));
  }
  // 回显到 stderr，方便排查；不进 stdout 以免污染可解析输出
  process.stderr.write(`$ ${args.join(" ")}\n`);

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, rest, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;

    const onAbort = () => {
      child.kill("SIGKILL");
      reject(new Error(`命令已取消: ${cmd}`));
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    };

    if (opts.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`命令超时 (${opts.timeoutMs}ms): ${cmd}`));
      }, opts.timeoutMs);
    }

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      cleanup();
      reject(new Error(`无法启动 ${cmd}: ${err.message}`));
    });

    child.on("close", (code) => {
      cleanup();
      if (code !== 0) {
        const tail = stderr.trim().split("\n").slice(-20).join("\n");
        reject(
          new Error(`命令失败 (exit ${code}): ${cmd}\n--- stderr 尾部 ---\n${tail}`),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
