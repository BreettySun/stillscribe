/**
 * 编排器：串行队列 + 状态机 + 取消 + 重启恢复。
 *
 * 并发限流：串行（同时只跑 1 个任务），这是首版对 YouTube 的天然节流。
 * 单批 ≤ DEFAULTS.maxBatchSize 在 server 层校验。
 * 注：批次间最小时间间隔(minBatchIntervalMs)首版暂未强制（会让开发/测试无法连续提交）——留待后续按真实风险落参数。
 *
 * 状态机：queued → running → (awaiting_review | failed | canceled)
 *         awaiting_review → running(导出) → completed
 *         completed → running(重新导出) → completed
 *         failed/canceled → queued（重试）
 * 半自动(semi)：runToGrids 完成即停在 awaiting_review，等人工回填 article 后再 exportArticle。
 * 全自动(auto)：runToGrids 后直接调模型(M7) 生成 article 草稿再进 awaiting_review（仍让人工校对/换图）；
 *               缺 Key / API 失败则降级——不让任务失败，照样进 awaiting_review 让人工接手（AI 集成文档 §6）。
 */
import {
  EXPORT_FORMATS,
  type ExportFormat,
  type ExportResult,
  type SwapImageRequest,
  type Task,
  type TaskParams,
  type TaskStatus,
} from "@shared/types";
import { TaskDir, resolveCookiesFile } from "../paths.ts";
import { runToGrids, runExport, runArticle, type GridsResult } from "./pipeline.ts";
import { resolveAIConfig } from "../modules/m7/config.ts";
import { createArticleClient } from "../modules/m7/articleClient.ts";
import type { EventBus } from "./events.ts";
import type { TaskStore } from "../store/tasks.ts";

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  queued: ["running", "canceled"],
  running: ["awaiting_review", "completed", "failed", "canceled"],
  awaiting_review: ["running", "completed", "failed", "canceled"],
  completed: ["awaiting_review", "running"], // awaiting_review=返回校对；running=原样重新导出
  failed: ["queued", "awaiting_review"], // queued=重试整条流水线；awaiting_review=导出失败回校对
  canceled: ["queued"],
};

/** 状态迁移是否合法（纯函数，供测试与运行时校验共用）。 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export interface OrchestratorOptions {
  workRoot: string;
  /** --cookies-from-browser（可选）。 */
  browser?: string;
}

export class Orchestrator {
  private readonly queue: string[] = [];
  private readonly running = new Map<string, AbortController>();
  private active = false;

  constructor(
    private readonly store: TaskStore,
    private readonly bus: EventBus,
    private readonly opts: OrchestratorOptions,
  ) {}

  /** 提交单个任务，入队并触发处理。 */
  submit(params: TaskParams): Task {
    const task = this.store.create(params);
    this.bus.emit({ type: "task_created", task });
    this.queue.push(task.id);
    this.pump();
    return task;
  }

  /** 重启恢复：running 复位为 queued 重新入队（流水线幂等，会跳过已完成步骤）；queued 重新入队。 */
  recover(): void {
    for (const t of this.store.list()) {
      if (t.status === "running") {
        this.store.update(t.id, { status: "queued", currentStep: null });
        this.queue.push(t.id);
      } else if (t.status === "queued") {
        this.queue.push(t.id);
      }
    }
    this.pump();
  }

  cancel(id: string): Task {
    const task = this.store.get(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    if (task.status === "running") {
      this.running.get(id)?.abort(); // runTask 的 catch 会落 canceled
    } else if (task.status === "queued" || task.status === "awaiting_review") {
      const idx = this.queue.indexOf(id);
      if (idx >= 0) this.queue.splice(idx, 1);
      this.transition(id, "canceled");
    }
    return this.store.get(id)!;
  }

  /** 原地重试：failed/canceled 任务重置为 queued 重新入队（流水线幂等，跳过已完成步骤），保留同一 id。 */
  retry(id: string): Task {
    const task = this.store.get(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    if (task.status !== "failed" && task.status !== "canceled") {
      throw new Error(`仅失败/已取消的任务可重试，当前: ${task.status}`);
    }
    this.store.update(id, { status: "queued", error: null, currentStep: null });
    this.bus.emit({ type: "status_changed", taskId: id, status: "queued" });
    this.queue.push(id);
    this.pump();
    return this.store.get(id)!;
  }

  /** 删除任务：从队列/库中移除并广播。running 须先取消（避免与中止竞态）。产物文件不动。 */
  remove(id: string): void {
    const task = this.store.get(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    if (task.status === "running") throw new Error("正在处理的任务请先取消再删除");
    const idx = this.queue.indexOf(id);
    if (idx >= 0) this.queue.splice(idx, 1);
    this.store.delete(id);
    this.bus.emit({ type: "task_deleted", taskId: id });
  }

  /** 半自动回填：存 article，仍停在 awaiting_review，等触发导出。 */
  setArticle(id: string, article: Task["article"]): Task {
    const task = this.store.get(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    return this.store.update(id, { article: article ?? null });
  }

  /**
   * 返回上一步（结果页/失败页 → 校对页）：completed | failed → awaiting_review。
   * 清 error（失败后回退则作废旧错误）；outputs 保留（下次导出覆盖同路径）。
   * 导出失败时 article 仍在，可直接回校对重试，无需重跑整条流水线。
   */
  reopenReview(id: string): Task {
    const task = this.store.get(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    if (!task.article) throw new Error("任务尚无 article，无法返回校对");
    this.store.update(id, { currentStep: null, error: null });
    this.transition(id, "awaiting_review");
    const after = this.store.get(id)!;
    this.bus.emit({ type: "awaiting_review", taskId: id, article: after.article! });
    return after;
  }

  /** 换图：改某页配图时间戳。 */
  swap(id: string, req: SwapImageRequest): Task {
    const task = this.store.get(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    if (!task.article) throw new Error("任务尚无 article，无法换图");
    const pages = task.article.pages;
    if (req.pageIndex < 0 || req.pageIndex >= pages.length) {
      throw new Error(`pageIndex 越界: ${req.pageIndex}（共 ${pages.length} 页）`);
    }
    const next = structuredClone(task.article);
    next.pages[req.pageIndex]!.image = req.image;
    return this.store.update(id, { article: next });
  }

  /**
   * 导出（M8）：awaiting_review | completed → running → completed。
   * 产物全部是本地文件（docx / Markdown / HTML），落在任务目录 article/ 下；省略 formats = 全部格式。
   * 失败落 failed（article 仍在，可回校对重试）。
   */
  async exportArticle(
    id: string,
    formats: readonly ExportFormat[] = EXPORT_FORMATS,
  ): Promise<ExportResult> {
    const task = this.store.get(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    if (!task.article) throw new Error("任务尚无 article，无法导出（semi 模式请先回填）");
    if (!task.workDir) throw new Error("任务无 workDir（下载/抽帧未完成？）");
    if (task.status !== "awaiting_review" && task.status !== "completed") {
      throw new Error(`仅校对中或已完成的任务可导出，当前: ${task.status}`);
    }

    this.transition(id, "running");
    this.store.update(id, { currentStep: "export", error: null });
    try {
      const { outputs, warnings } = await runExport(
        task.article,
        new TaskDir(task.workDir),
        {
          formats,
          sourceUrl: task.params.url,
          ...(task.videoTitle ? { fallbackTitle: task.videoTitle } : {}),
        },
        (progress) => {
          this.bus.emit({ type: "progress", taskId: id, progress });
        },
      );
      // 只导出部分格式时，保留其余格式上次的产物路径。
      const merged = { ...task.outputs, ...outputs };
      this.store.update(id, { outputs: merged, currentStep: null });
      this.transition(id, "completed");
      this.bus.emit({ type: "completed", taskId: id, outputs: merged });
      return { outputs, warnings };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.store.update(id, { error: msg, currentStep: null });
      this.transition(id, "failed");
      this.bus.emit({ type: "failed", taskId: id, error: msg });
      throw err;
    }
  }

  // ---- 内部 ----

  /**
   * M7 全自动：构造 client → 生成 Article → 存库（+落盘 article.json）。
   * 任何缺配置 / API 失败都【不让任务失败】，只记日志并降级——仍进 awaiting_review 让人工接手（§6）。
   */
  private async tryAutoArticle(id: string, grids: GridsResult): Promise<void> {
    const cfg = resolveAIConfig();
    if (!cfg.apiKey) {
      process.stderr.write(`[m7] 未配置模型 API Key，降级半自动 (task ${id})\n`);
      return;
    }
    try {
      const client = createArticleClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model });
      this.store.update(id, { currentStep: "article" });
      const promptOverride = this.store.get(id)?.params.promptOverride;
      const { article, warnings } = await runArticle(
        grids.taskDir,
        {
          client,
          videoTitle: grids.videoTitle,
          imageSource: cfg.imageSource,
          modelLabel: cfg.model,
          ...(promptOverride != null ? { promptOverride } : {}),
        },
        (progress) => {
          this.store.update(id, { currentStep: progress.step });
          this.bus.emit({ type: "progress", taskId: id, progress });
        },
      );
      for (const w of warnings) process.stderr.write(`[m7][warn] ${w} (task ${id})\n`);
      this.store.update(id, { article, currentStep: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[m7] 全自动失败，降级半自动 (task ${id}): ${msg}\n`);
      this.store.update(id, { currentStep: null });
    }
  }

  private transition(id: string, to: TaskStatus): void {
    const current = this.store.get(id);
    if (current && !canTransition(current.status, to)) {
      // 不抛错——记日志即可，避免竞态把整个 worker 拖崩。
      process.stderr.write(`[orchestrator] 非法状态迁移 ${current.status} → ${to} (task ${id})\n`);
    }
    this.store.update(id, { status: to });
    this.bus.emit({ type: "status_changed", taskId: id, status: to });
  }

  private pump(): void {
    if (this.active) return; // 串行：同时只跑一个
    const next = this.queue.shift();
    if (!next) return;
    this.active = true;
    void this.runTask(next).finally(() => {
      this.active = false;
      this.pump();
    });
  }

  private async runTask(id: string): Promise<void> {
    const task = this.store.get(id);
    if (!task || task.status === "canceled") return;

    const ac = new AbortController();
    this.running.set(id, ac);
    try {
      this.transition(id, "running");
      this.store.update(id, { error: null });
      // 按任务即时探测 cookies.txt（P1 方案 A）：跑完 refresh-cookies 无需重启即生效；
      // 文件缺失/被置空时 cookiesFile=undefined → 自动回退 --cookies-from-browser。
      const cookiesFile = resolveCookiesFile(this.opts.workRoot);
      const grids = await runToGrids(task.params, {
        workRoot: this.opts.workRoot,
        // 任务级 browser 优先，回退到启动时的全局 STILLSCRIBE_BROWSER 默认。
        browser: task.params.browser ?? this.opts.browser,
        ...(cookiesFile ? { cookiesFile } : {}),
        signal: ac.signal,
        onInfo: ({ workDir, videoTitle }) => {
          this.store.update(id, { workDir, videoTitle });
          // 立即广播，否则 UI 要等下一次交互（重新拉取）才看到标题。
          this.bus.emit({ type: "info", taskId: id, videoTitle, workDir });
        },
        onStep: (progress) => {
          this.store.update(id, { currentStep: progress.step });
          this.bus.emit({ type: "progress", taskId: id, progress });
        },
      });
      this.store.update(id, { currentStep: null });

      // auto：直接调模型生成 article（失败则降级，仍进 awaiting_review）。
      // semi：跳过，停在 awaiting_review 等人工回填。
      if (task.params.mode === "auto") {
        await this.tryAutoArticle(id, grids);
      }
      this.transition(id, "awaiting_review");
      // auto 成功后 awaiting_review 携带 article 草稿（契约：semi 此事件无 article）。
      const after = this.store.get(id);
      if (after?.article) {
        this.bus.emit({ type: "awaiting_review", taskId: id, article: after.article });
      }
    } catch (err) {
      if (ac.signal.aborted) {
        this.transition(id, "canceled");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        this.store.update(id, { error: msg });
        this.transition(id, "failed");
        this.bus.emit({ type: "failed", taskId: id, error: msg });
      }
    } finally {
      this.running.delete(id);
    }
  }
}
