import { describe, it, expect, vi, beforeEach } from "vitest";

const spanEnd = vi.fn();
const spanSetStatus = vi.fn();
const spanSetAttribute = vi.fn();
const startInactiveSpan = vi.fn((..._a: unknown[]) => ({
  end: spanEnd,
  setStatus: spanSetStatus,
  setAttribute: spanSetAttribute,
}));

vi.mock("@sentry/nextjs", () => ({
  startInactiveSpan: (...a: unknown[]) => startInactiveSpan(...a),
}));

import { withSpan } from "./spans";

describe("withSpan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the wrapped function's result", async () => {
    const result = await withSpan("test.op", {}, async () => 42);
    expect(result).toBe(42);
  });

  it("creates a span with name, op and merged tag/data attributes", async () => {
    await withSpan(
      "turn.phase.fundGeneration",
      { op: "turn.phase", tags: { turn: 7 }, data: { nested: { a: 1 } } },
      async () => undefined
    );
    expect(startInactiveSpan).toHaveBeenCalledTimes(1);
    const arg = startInactiveSpan.mock.calls[0][0] as {
      name: string;
      op: string;
      attributes: Record<string, unknown>;
    };
    expect(arg.name).toBe("turn.phase.fundGeneration");
    expect(arg.op).toBe("turn.phase");
    expect(arg.attributes.turn).toBe(7);
    // Objects are JSON-stringified so they aren't silently dropped.
    expect(arg.attributes.nested).toBe(JSON.stringify({ a: 1 }));
  });

  it("defaults op to 'function' when omitted", async () => {
    await withSpan("x", {}, async () => undefined);
    const arg = startInactiveSpan.mock.calls[0][0] as { op: string };
    expect(arg.op).toBe("function");
  });

  it("sets status OK on success and ends the span", async () => {
    await withSpan("ok.op", {}, async () => "done");
    expect(spanSetStatus).toHaveBeenCalledWith({ code: 1 });
    expect(spanEnd).toHaveBeenCalledTimes(1);
  });

  it("sets status ERROR with message on throw, ends the span, and re-throws", async () => {
    const boom = new Error("kaboom");
    await expect(
      withSpan("bad.op", {}, async () => {
        throw boom;
      })
    ).rejects.toThrow("kaboom");

    expect(spanSetStatus).toHaveBeenCalledWith({ code: 2, message: "kaboom" });
    expect(spanEnd).toHaveBeenCalledTimes(1);
  });

  it("skips null/undefined data attributes", async () => {
    await withSpan(
      "x",
      { data: { keep: "v", drop: null, gone: undefined } },
      async () => undefined
    );
    const attrs = (startInactiveSpan.mock.calls[0][0] as { attributes: Record<string, unknown> })
      .attributes;
    expect(attrs.keep).toBe("v");
    expect("drop" in attrs).toBe(false);
    expect("gone" in attrs).toBe(false);
  });
});
