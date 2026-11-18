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
  /** 实时回调每段 stdout（用于解析进度，如 yt-dlp/ffmpeg -progress）；不影响最终缓冲返回。 */
  onStdout?(chunk: string): void;
  /** 实时回调每段 stderr（ffmpeg 进度走 stderr）。 */
  onStderr?(chunk: string): void;
}

/**
 * 不得传给外部 CLI 子进程的环境变量（铁律 #6）：模型服务 Key（表 / 单 Key / 旧名）与引擎接口令牌
 * （子进程拿到令牌就能调设置路由）。yt-dlp、它拉起的 deno、ffmpeg/ffprobe 都用不到它们。
 */
const CHILD_ENV_DENYLIST = [
  "STILLSCRIBE_AI_KEYS",
  "STILLSCRIBE_AI_API_KEY",
  "STILLSCRIBE_GEMINI_API_KEY",
  "STILLSCRIBE_TOKEN",
] as const;

/**
 * 外部 CLI 子进程用的环境：父进程环境去掉 CHILD_ENV_DENYLIST，返回新对象、不改入参。
 * 不从 process.env 里删这些变量——AIConfig 之后还会从 process.env 读（queue.ts / run.ts）。
 */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const k of CHILD_ENV_DENYLIST) delete out[k];
  return out;
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
    const child = spawn(cmd, rest, { stdio: ["ignore", "pipe", "pipe"], env: childEnv(process.env) });
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

    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      opts.onStdout?.(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      opts.onStderr?.(s);
    });

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
