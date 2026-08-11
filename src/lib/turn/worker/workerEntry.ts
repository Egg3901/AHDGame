import { parentPort } from "worker_threads";
import { processTurn } from "@/lib/turnSystem";

/*
 * Worker bootstrap for #9 (turn isolation).
 *
 * Lives in its own V8 isolate spawned by runTurnInWorker. Receives one
 * { type: "run", source } message, runs processTurn, posts the result back,
 * and exits. All per-turn allocations die when the worker process exits, so
 * the parent process's heap stays flat regardless of which Map / cache /
 * cursor inside processTurn would otherwise have retained memory.
 *
 * Design doc: docs/plans/archive/2026-05/2026-05-25-turn-worker-thread.md
 *
 * Phase 1 (current): file is bundled but no production caller invokes it
 * yet. Phase 2 will switch cron.ts to runTurnInWorker.
 */

if (!parentPort) {
  // Defensive — this file only runs inside a worker_thread. If someone
  // requires it from the parent process (e.g. accidental import), refuse to
  // start anything.
  throw new Error("workerEntry.ts must be run inside a worker_thread");
}

type RunMessage = { type: "run"; source: string };

function isRunMessage(value: unknown): value is RunMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown; source?: unknown };
  return v.type === "run" && typeof v.source === "string";
}

// Yield to the event loop before exit so the postMessage above has a chance
// to flush to the parent. Synchronous process.exit() right after postMessage
// can drop the message in transit; setImmediate guarantees one event-loop
// tick before exit, which is enough for worker_threads to drain its queue.
function exitAfterFlush(code: number): void {
  setImmediate(() => process.exit(code));
}

parentPort.on("message", async (msg: unknown) => {
  if (!isRunMessage(msg)) {
    parentPort!.postMessage({
      type: "error",
      message: `Worker received malformed run message: ${JSON.stringify(msg)}`,
    });
    exitAfterFlush(1);
    return;
  }

  try {
    const payload = await processTurn();
    parentPort!.postMessage({ type: "result", payload });
    exitAfterFlush(0);
  } catch (err) {
    parentPort!.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    exitAfterFlush(1);
  }
});
