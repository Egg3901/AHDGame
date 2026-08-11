import { describe, it, expect, vi, beforeEach } from "vitest";

const spanEnd = vi.fn();
const spanSetStatus = vi.fn();
const spanSetAttribute = vi.fn();
const startInactiveSpan = vi.fn((..._a: unknown[]) => ({
  end: spanEnd,
  setStatus: spanSetStatus,
  setAttribute: spanSetAttribute,
}));
const setTag = vi.fn();
const captureMessage = vi.fn();
const addBreadcrumb = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  startInactiveSpan: (...a: unknown[]) => startInactiveSpan(...a),
  setTag: (...a: unknown[]) => setTag(...a),
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  addBreadcrumb: (...a: unknown[]) => addBreadcrumb(...a),
}));

import { withApiMetrics } from "./apiMetrics";

function tagValue(key: string): unknown {
  const call = [...setTag.mock.calls].reverse().find((c) => c[0] === key);
  return call?.[1];
}

describe("withApiMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the handler's response unchanged", async () => {
    const res = new Response("ok", { status: 200 });
    const wrapped = withApiMetrics("test.route", async (_req: Request) => res);
    const out = await wrapped(new Request("http://x/"));
    expect(out).toBe(res);
  });

  it("tags api.route and opens/ends a span", async () => {
    const wrapped = withApiMetrics(
      "elections.GET",
      async () => new Response(null, { status: 200 })
    );
    await wrapped();
    expect(startInactiveSpan).toHaveBeenCalledTimes(1);
    expect((startInactiveSpan.mock.calls[0][0] as { name: string }).name).toBe("elections.GET");
    expect(tagValue("api.route")).toBe("elections.GET");
    expect(spanEnd).toHaveBeenCalledTimes(1);
  });

  it("marks availability true and span OK on a 2xx", async () => {
    const wrapped = withApiMetrics("r", async () => new Response(null, { status: 204 }));
    await wrapped();
    expect(tagValue("slo.api_availability")).toBe("true");
    expect(spanSetStatus).toHaveBeenCalledWith({ code: 1 });
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("does NOT capture 4xx as an issue (expected control flow), only a breadcrumb", async () => {
    const wrapped = withApiMetrics("r", async () => new Response(null, { status: 404 }));
    await wrapped();
    expect(tagValue("slo.api_availability")).toBe("true");
    expect(captureMessage).not.toHaveBeenCalled();
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(spanSetAttribute).toHaveBeenCalledWith("api.status", 404);
  });

  it("marks 5xx as availability false + span ERROR + error breadcrumb, but emits NO issue", async () => {
    const wrapped = withApiMetrics("r", async () => new Response(null, { status: 500 }));
    await wrapped();
    expect(tagValue("slo.api_availability")).toBe("false");
    expect(spanSetStatus).toHaveBeenCalledWith({ code: 2 });
    expect(spanSetAttribute).toHaveBeenCalledWith("api.status", 500);
    // No synthetic issue — the real exception is captured by handleRouteError.
    expect(captureMessage).not.toHaveBeenCalled();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", category: "api" })
    );
  });

  it("propagates thrown errors, marks availability false, sets span ERROR, and ends span", async () => {
    const boom = new Error("handler blew up");
    const wrapped = withApiMetrics("r", async () => {
      throw boom;
    });
    await expect(wrapped()).rejects.toThrow("handler blew up");
    expect(tagValue("slo.api_availability")).toBe("false");
    expect(spanSetStatus).toHaveBeenCalledWith({ code: 2, message: "handler blew up" });
    expect(spanEnd).toHaveBeenCalledTimes(1);
  });
});
