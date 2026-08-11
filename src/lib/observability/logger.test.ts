import { describe, it, expect, vi, beforeEach } from "vitest";

const captureException = vi.fn();
const captureMessage = vi.fn();
const addBreadcrumb = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => captureException(...a),
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  addBreadcrumb: (...a: unknown[]) => addBreadcrumb(...a),
}));

import { logger } from "./logger";

describe("logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("info() adds a breadcrumb, never captures an event", () => {
    logger.info("turn", "phase started", { phase: "fundGeneration" });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: "turn", level: "info", message: "phase started" })
    );
    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("warn() logs to console (mirrored to Logs) without capturing an event", () => {
    logger.warn("auth", "token near expiry");
    expect(console.warn).toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("error() with an Error captures an exception tagged by component", () => {
    const err = new Error("db down");
    logger.error("stock", "purchase failed", err, { corpId: "x" });
    expect(captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        level: "error",
        tags: { component: "stock" },
        extra: expect.objectContaining({ message: "purchase failed", corpId: "x" }),
      })
    );
  });

  it("error() without an Error falls back to captureMessage", () => {
    logger.error("elections", "unexpected empty tally");
    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).toHaveBeenCalledWith(
      "[elections] unexpected empty tally",
      expect.objectContaining({ level: "error", tags: { component: "elections" } })
    );
  });

  it("fatal() captures at fatal level, synthesizing an Error when none is given", () => {
    logger.fatal("turn", "engine wedged");
    expect(captureException).toHaveBeenCalledTimes(1);
    const [errArg, opts] = captureException.mock.calls[0];
    expect(errArg).toBeInstanceOf(Error);
    expect(opts).toMatchObject({ level: "fatal", tags: { component: "turn" } });
  });
});
