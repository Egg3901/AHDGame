import { Worker } from "worker_threads";
import * as path from "path";

/*
 * Parent-side wrapper that runs processTurn() inside a worker_thread, so
 * per-turn allocations live in a separate V8 heap that dies with the worker.
 *
 * Phase 1 (this file) ships the wrapper + tests as dead code — no caller
 * switches yet. Phase 2 will switch cron.ts to call this in place of the
 * direct processTurn() invocation, after sandbox deployment confirms Next.js
 * standalone tracing bundles workerEntry.ts correctly.
 *
 * Design doc: docs/plans/archive/2026-05/2026-05-25-turn-worker-thread.md
 */

export interface WorkerLike {
  postMessage(value: unknown): void;
  terminate(): Promise<number>;
  on(event: string, listener: (...args: unknown[]) => void): WorkerLike;
  removeAllListeners(): WorkerLike;
}

export interface TurnResult {
  success: boolean;
  turn: number;
  message: string;
  warnings: string[];
}

export interface RunTurnInWorkerDeps {
  createWorker?: () => WorkerLike;
  timeoutMs?: number;
}

// Generous default — the longest recorded sandbox turn was ~74s; 5min covers
// pathological growth without making a stuck worker drag the cron tick out
// past the 30-min schedule window.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class WorkerCrashedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerCrashedError";
  }
}

export class WorkerTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerTimeoutError";
  }
}

type WorkerMessage =
  { type: "result"; payload: TurnResult } | { type: "error"; message: string; stack?: string };

function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown };
  return v.type === "result" || v.type === "error";
}

/**
 * Default worker factory. Resolves the compiled workerEntry.js next to this
 * file at runtime. In Next.js standalone build the file lands beside the
 * wrapper inside .next/standalone — verified during Phase 2 deployment.
 */
function defaultCreateWorker(): WorkerLike {
  // `__dirname` resolves to the directory of the compiled .js, so workerEntry
  // sits next to it. Worker_threads requires a real on-disk path; using a
  // relative URL would fail under Next.js's webpack output where module ids
  // are numeric.
  const entryPath = path.join(__dirname, "workerEntry.js");
  return new Worker(entryPath) as unknown as WorkerLike;
}

export function runTurnInWorker(
  source: string,
  deps: RunTurnInWorkerDeps = {}
): Promise<TurnResult> {
  const create = deps.createWorker ?? defaultCreateWorker;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<TurnResult>((resolve, reject) => {
    const worker = create();
    let settled = false;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      worker.removeAllListeners();
      fn();
    };

    const timeoutHandle = setTimeout(() => {
      // Best-effort terminate; swallow rejection because we're already
      // rejecting with a timeout error and the worker may already be gone.
      worker.terminate().catch(() => {});
      settle(() =>
        reject(
          new WorkerTimeoutError(`Turn worker timed out after ${timeoutMs}ms (source=${source})`)
        )
      );
    }, timeoutMs);

    worker.on("message", (...args: unknown[]) => {
      const msg = args[0];
      if (!isWorkerMessage(msg)) {
        settle(() =>
          reject(
            new Error(
              `Worker posted malformed message: ${typeof msg === "object" ? JSON.stringify(msg) : String(msg)}`
            )
          )
        );
        return;
      }
      if (msg.type === "result") {
        settle(() => resolve(msg.payload));
      } else {
        const err = new Error(msg.message);
        if (msg.stack) err.stack = msg.stack;
        settle(() => reject(err));
      }
    });

    worker.on("error", (...args: unknown[]) => {
      const err = args[0];
      settle(() => reject(err instanceof Error ? err : new Error(`Worker error: ${String(err)}`)));
    });

    worker.on("exit", (...args: unknown[]) => {
      const code = typeof args[0] === "number" ? args[0] : -1;
      if (code !== 0) {
        settle(() =>
          reject(new WorkerCrashedError(`Turn worker exited with code ${code} (source=${source})`))
        );
        return;
      }
      // Clean exit (code 0) AFTER a result message is normal — the result
      // already settled the promise and the settled flag short-circuits this.
      // Clean exit BEFORE a result means the worker called process.exit too
      // fast and dropped the message in flight, or processTurn returned but
      // postMessage never queued. Treat as a crash so the cron's stale-lock
      // takeover gets a chance on the next tick instead of hanging until the
      // 5-minute timeout.
      settle(() =>
        reject(
          new WorkerCrashedError(
            `Turn worker exited cleanly without posting a result (source=${source})`
          )
        )
      );
    });

    worker.postMessage({ type: "run", source });
  });
}
