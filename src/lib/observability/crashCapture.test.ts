import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EventEmitter } from "events";

// installCrashCapture must capture the rejection/exception to Sentry, flush
// pending events so the capture actually reaches Sentry before the process
// terminates, and then exit(1) so Railway sees a non-zero exit and restarts
// the container. Today the container can die silently with no Sentry signal.

const captureException = vi.fn();
const flush = vi.fn().mockResolvedValue(true);
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  flush: (...args: unknown[]) => flush(...args),
}));

type Handler = (...args: unknown[]) => Promise<void> | void;

function makeFakeProcess(): {
  on: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
  handlers: Map<string, Handler>;
} {
  const handlers = new Map<string, Handler>();
  const on = vi.fn((event: string, handler: Handler) => {
    handlers.set(event, handler);
    return undefined as unknown as EventEmitter;
  });
  const exit = vi.fn();
  return { on, exit, handlers };
}

describe("installCrashCapture", () => {
  beforeEach(() => {
    captureException.mockReset();
    flush.mockReset();
    flush.mockResolvedValue(true);
  });

  it("registers both unhandledRejection and uncaughtException listeners on process", async () => {
    const fakeProc = makeFakeProcess();
    const { installCrashCapture } = await import("./crashCapture");

    installCrashCapture({ process: fakeProc as unknown as NodeJS.Process });

    expect(fakeProc.on).toHaveBeenCalledWith("unhandledRejection", expect.any(Function));
    expect(fakeProc.on).toHaveBeenCalledWith("uncaughtException", expect.any(Function));
  });

  it("captures unhandledRejection to Sentry, flushes, then exits 1", async () => {
    const fakeProc = makeFakeProcess();
    const { installCrashCapture } = await import("./crashCapture");

    installCrashCapture({ process: fakeProc as unknown as NodeJS.Process });
    const handler = fakeProc.handlers.get("unhandledRejection")!;

    const reason = new Error("boom: unhandled async");
    await handler(reason);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      reason,
      expect.objectContaining({
        tags: expect.objectContaining({ source: "unhandledRejection" }),
      })
    );
    // Flush must be awaited before exit so the event reaches Sentry.
    expect(flush).toHaveBeenCalledTimes(1);
    expect(fakeProc.exit).toHaveBeenCalledWith(1);
  });

  it("captures uncaughtException to Sentry, flushes, then exits 1", async () => {
    const fakeProc = makeFakeProcess();
    const { installCrashCapture } = await import("./crashCapture");

    installCrashCapture({ process: fakeProc as unknown as NodeJS.Process });
    const handler = fakeProc.handlers.get("uncaughtException")!;

    const err = new Error("boom: uncaught sync");
    await handler(err);

    expect(captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        tags: expect.objectContaining({ source: "uncaughtException" }),
      })
    );
    expect(flush).toHaveBeenCalledTimes(1);
    expect(fakeProc.exit).toHaveBeenCalledWith(1);
  });

  it("still exits when Sentry flush rejects (don't hang the process)", async () => {
    flush.mockRejectedValueOnce(new Error("sentry network down"));
    const fakeProc = makeFakeProcess();
    const { installCrashCapture } = await import("./crashCapture");

    installCrashCapture({ process: fakeProc as unknown as NodeJS.Process });
    const handler = fakeProc.handlers.get("unhandledRejection")!;
    await handler(new Error("anything"));

    // Even if flush rejects, we must exit — a hung crash handler is worse than
    // losing one Sentry event.
    expect(fakeProc.exit).toHaveBeenCalledWith(1);
  });
});
