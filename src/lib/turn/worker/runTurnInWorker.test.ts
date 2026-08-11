import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import {
  runTurnInWorker,
  WorkerCrashedError,
  WorkerTimeoutError,
  type WorkerLike,
} from "./runTurnInWorker";

// Phase-1 scaffolding for #9. Tests inject a fake worker via the createWorker
// dep seam so we exercise the wrapper's failure-mode handling without spawning
// real worker_threads. Real worker spawn + bundling is validated separately
// during Phase 2 sandbox deployment.

type FakeWorker = {
  _emitter: EventEmitter;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  on: (event: string, listener: (...args: unknown[]) => void) => FakeWorker;
  removeAllListeners: () => FakeWorker;
};

function createFakeWorker(): FakeWorker {
  const emitter = new EventEmitter();
  const worker: FakeWorker = {
    _emitter: emitter,
    postMessage: vi.fn(),
    terminate: vi.fn().mockResolvedValue(0),
    on(event: string, listener: (...args: unknown[]) => void) {
      emitter.on(event, listener);
      return worker;
    },
    removeAllListeners() {
      emitter.removeAllListeners();
      return worker;
    },
  };
  return worker;
}

// Cast at the call boundary — FakeWorker matches WorkerLike structurally but
// vi.fn() types are wider than the precise signatures WorkerLike specifies.
function asWorkerLike(w: FakeWorker): WorkerLike {
  return w as unknown as WorkerLike;
}

describe("runTurnInWorker", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the worker's result payload on happy path", async () => {
    const worker = createFakeWorker();
    const promise = runTurnInWorker("test-source", {
      createWorker: () => asWorkerLike(worker),
      timeoutMs: 5_000,
    });

    // Worker posts a result message after receiving the run command.
    await Promise.resolve(); // let the wrapper attach listeners
    worker._emitter.emit("message", {
      type: "result",
      payload: { success: true, turn: 42, message: "ok", warnings: [] },
    });
    worker._emitter.emit("exit", 0);

    const result = await promise;
    expect(result).toEqual({ success: true, turn: 42, message: "ok", warnings: [] });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "run", source: "test-source" });
  });

  it("rejects with the worker's error when worker posts an error message", async () => {
    const worker = createFakeWorker();
    const promise = runTurnInWorker("test-source", {
      createWorker: () => asWorkerLike(worker),
      timeoutMs: 5_000,
    });
    await Promise.resolve();

    worker._emitter.emit("message", {
      type: "error",
      message: "NPP behavior phase crashed",
      stack: "Error: NPP behavior phase crashed\n  at processTurn",
    });
    worker._emitter.emit("exit", 1);

    await expect(promise).rejects.toThrow("NPP behavior phase crashed");
  });

  it("rejects with WorkerCrashedError when the worker exits non-zero without a result", async () => {
    const worker = createFakeWorker();
    const promise = runTurnInWorker("test-source", {
      createWorker: () => asWorkerLike(worker),
      timeoutMs: 5_000,
    });
    await Promise.resolve();

    // V8 OOM in the worker — no result message, just an abrupt exit.
    worker._emitter.emit("exit", 134); // 128 + SIGABRT

    await expect(promise).rejects.toBeInstanceOf(WorkerCrashedError);
    await expect(promise).rejects.toThrow(/exited with code 134/);
    await expect(promise).rejects.toThrow(/test-source/);
  });

  it("rejects with the underlying error when the worker emits an 'error' event", async () => {
    const worker = createFakeWorker();
    const promise = runTurnInWorker("test-source", {
      createWorker: () => asWorkerLike(worker),
      timeoutMs: 5_000,
    });
    await Promise.resolve();

    // Node fires 'error' for unhandled exceptions in the worker before exit.
    worker._emitter.emit("error", new Error("uncaught in worker"));

    await expect(promise).rejects.toThrow("uncaught in worker");
  });

  it("rejects with WorkerTimeoutError and terminates the worker on timeout", async () => {
    vi.useFakeTimers();
    const worker = createFakeWorker();
    const promise = runTurnInWorker("test-source", {
      createWorker: () => asWorkerLike(worker),
      timeoutMs: 1_000,
    });
    // Attach the rejection handler synchronously BEFORE advancing fake
    // timers, otherwise the promise rejects inside advanceTimersByTimeAsync
    // before the `.rejects` matcher attaches its handler and Node emits a
    // spurious PromiseRejectionHandledWarning.
    const rejection = promise.catch((err) => err);
    // Advance past the timeout — the worker never posts a result.
    await vi.advanceTimersByTimeAsync(1_500);

    const err = await rejection;
    expect(err).toBeInstanceOf(WorkerTimeoutError);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("ignores a clean exit (code 0) that races with a successful result message", async () => {
    // After the wrapper resolves on the result message, the worker may also
    // emit 'exit' with code 0 milliseconds later. The wrapper must not double-
    // settle in either direction.
    const worker = createFakeWorker();
    const promise = runTurnInWorker("test-source", {
      createWorker: () => asWorkerLike(worker),
      timeoutMs: 5_000,
    });
    await Promise.resolve();

    worker._emitter.emit("message", {
      type: "result",
      payload: { success: true, turn: 1, message: "ok", warnings: [] },
    });
    // Now emit the clean exit AFTER the result. Should be a no-op.
    worker._emitter.emit("exit", 0);

    await expect(promise).resolves.toMatchObject({ success: true, turn: 1 });
  });

  it("rejects with WorkerCrashedError when worker exits cleanly without a prior result", async () => {
    // If workerEntry calls process.exit(0) so fast the postMessage drops in
    // transit, the parent sees only the exit event. Without defensive
    // handling the promise would hang until the 5-min timeout; we want a
    // fast rejection so the cron's stale-lock takeover gets the next tick.
    const worker = createFakeWorker();
    const promise = runTurnInWorker("test-source", {
      createWorker: () => asWorkerLike(worker),
      timeoutMs: 5_000,
    });
    await Promise.resolve();

    worker._emitter.emit("exit", 0);

    await expect(promise).rejects.toBeInstanceOf(WorkerCrashedError);
    await expect(promise).rejects.toThrow(/without posting a result/);
  });

  it("rejects when the worker posts a malformed message instead of result/error", async () => {
    const worker = createFakeWorker();
    const promise = runTurnInWorker("test-source", {
      createWorker: () => asWorkerLike(worker),
      timeoutMs: 5_000,
    });
    await Promise.resolve();

    worker._emitter.emit("message", { type: "wat", payload: { something: "wrong" } });

    await expect(promise).rejects.toThrow(/malformed message/);
  });

  it("clears the timeout once the worker resolves so the timer does not leak", async () => {
    vi.useFakeTimers();
    const worker = createFakeWorker();
    const promise = runTurnInWorker("test-source", {
      createWorker: () => asWorkerLike(worker),
      timeoutMs: 1_000,
    });
    // Run microtasks so listeners attach.
    await vi.advanceTimersByTimeAsync(0);

    worker._emitter.emit("message", {
      type: "result",
      payload: { success: true, turn: 1, message: "ok", warnings: [] },
    });

    await expect(promise).resolves.toBeDefined();

    // Advance past the original timeout deadline — terminate must NOT fire,
    // because the timer was cleared on resolve.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(worker.terminate).not.toHaveBeenCalled();
  });
});
