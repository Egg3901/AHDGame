import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EventEmitter } from "events";

// installGracefulShutdown must, on SIGTERM/SIGINT: stop cron, release this
// process's in-flight turn lock, flush Sentry, then exit(0). This is what turns
// a redeploy-mid-turn from an up-to-an-hour wedge into instant recovery.

const flush = vi.fn().mockResolvedValue(true);
// The handler's own failure paths log through observability/logger, which
// reaches for addBreadcrumb/captureException/captureMessage — stub the whole
// surface it uses, or a logged error throws instead of being recorded.
vi.mock("@sentry/nextjs", () => ({
  flush: (...args: unknown[]) => flush(...args),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
// Every test injects its own stopCron/releaseLock, so these two are never
// CALLED here — but `await import("./shutdownHandler")` still evaluates them,
// and their module scope reaches the network (observed as ECONNREFUSED against
// localhost:3000, which under full-suite contention blew the 15s timeout while
// passing in isolation). Stub the imports so module load stays hermetic.
vi.mock("@/lib/cron", () => ({ stopCronJobs: vi.fn() }));
vi.mock("@/lib/turnSystem", () => ({
  releaseLocalProcessingLock: vi.fn().mockResolvedValue(true),
}));

type Handler = (...args: unknown[]) => Promise<void> | void;

function makeFakeProcess(): {
  once: ReturnType<typeof vi.fn>;
  prependOnceListener: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
  handlers: Map<string, Handler>;
} {
  const handlers = new Map<string, Handler>();
  const register = (event: string, handler: Handler) => {
    handlers.set(event, handler);
    return undefined as unknown as EventEmitter;
  };
  // `once` is kept on the fake so a regression back to it is visible as an
  // unexpected call, rather than silently registering nothing.
  const once = vi.fn(register);
  const prependOnceListener = vi.fn(register);
  const exit = vi.fn();
  return { once, prependOnceListener, exit, handlers };
}

describe("installGracefulShutdown", () => {
  beforeEach(() => {
    vi.resetModules(); // reset the module-level `shuttingDown` guard between tests
    flush.mockReset();
    flush.mockResolvedValue(true);
  });

  it("registers SIGTERM and SIGINT listeners", async () => {
    const fakeProc = makeFakeProcess();
    const { installGracefulShutdown } = await import("./shutdownHandler");

    installGracefulShutdown({
      process: fakeProc as unknown as NodeJS.Process,
      stopCron: vi.fn(),
      releaseLock: vi.fn().mockResolvedValue(true),
    });

    expect(fakeProc.prependOnceListener).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(fakeProc.prependOnceListener).toHaveBeenCalledWith("SIGINT", expect.any(Function));
  });

  // Regression guard for the 2026-08-28 stuck-turn spate. Next's start-server.js
  // registers its own SIGTERM handler (ending in process.exit(143)) BEFORE
  // instrumentation.ts loads this module, so a plain `once` makes us listener #2
  // and Next's exit truncates our in-flight lock release. We must prepend.
  it("prepends its signal listeners so Next's exit(143) cannot preempt the release", async () => {
    const fakeProc = makeFakeProcess();
    const { installGracefulShutdown } = await import("./shutdownHandler");

    installGracefulShutdown({
      process: fakeProc as unknown as NodeJS.Process,
      stopCron: vi.fn(),
      releaseLock: vi.fn().mockResolvedValue(true),
    });

    expect(fakeProc.prependOnceListener).toHaveBeenCalledTimes(2);
    expect(fakeProc.once).not.toHaveBeenCalled();
  });

  it("on SIGTERM: stops cron, releases the lock, flushes, then exits 0", async () => {
    const fakeProc = makeFakeProcess();
    const stopCron = vi.fn();
    const releaseLock = vi.fn().mockResolvedValue(true);
    const { installGracefulShutdown } = await import("./shutdownHandler");

    installGracefulShutdown({
      process: fakeProc as unknown as NodeJS.Process,
      stopCron,
      releaseLock,
    });

    await fakeProc.handlers.get("SIGTERM")!();

    expect(stopCron).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledWith("SIGTERM");
    expect(flush).toHaveBeenCalledTimes(1);
    expect(fakeProc.exit).toHaveBeenCalledWith(0);
  });

  it("still exits when the lock release rejects (don't hang the grace window)", async () => {
    const fakeProc = makeFakeProcess();
    const { installGracefulShutdown } = await import("./shutdownHandler");

    installGracefulShutdown({
      process: fakeProc as unknown as NodeJS.Process,
      stopCron: vi.fn(),
      releaseLock: vi.fn().mockRejectedValue(new Error("mongo unreachable")),
    });

    await fakeProc.handlers.get("SIGTERM")!();

    expect(fakeProc.exit).toHaveBeenCalledWith(0);
  });

  it("is idempotent — a second signal does not run cleanup twice", async () => {
    const fakeProc = makeFakeProcess();
    const stopCron = vi.fn();
    const { installGracefulShutdown } = await import("./shutdownHandler");

    installGracefulShutdown({
      process: fakeProc as unknown as NodeJS.Process,
      stopCron,
      releaseLock: vi.fn().mockResolvedValue(true),
    });

    await fakeProc.handlers.get("SIGTERM")!();
    await fakeProc.handlers.get("SIGINT")!();

    expect(stopCron).toHaveBeenCalledTimes(1);
    expect(fakeProc.exit).toHaveBeenCalledTimes(1);
  });
});
