import { describe, it, expect, vi, beforeEach } from "vitest";

const captureException = vi.fn();
vi.mock("@/lib/observability/sentryClientLazy", () => ({
  captureClientException: (...a: unknown[]) => captureException(...a),
}));

import { fetchJson, HttpError } from "./fetchJson";

function mockFetch(impl: () => Promise<Response> | Response) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

describe("fetchJson", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns parsed JSON on success without capturing", async () => {
    mockFetch(() => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const data = await fetchJson<{ ok: number }>("/api/x", { feature: "t" });
    expect(data).toEqual({ ok: 1 });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("throws HttpError on 4xx but does NOT capture (expected)", async () => {
    mockFetch(() => new Response("nope", { status: 403 }));
    await expect(fetchJson("/api/x", { feature: "t" })).rejects.toBeInstanceOf(HttpError);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("throws and captures on 5xx (our fault)", async () => {
    mockFetch(() => new Response("boom", { status: 500 }));
    await expect(fetchJson("/api/x", { feature: "portfolio" })).rejects.toBeInstanceOf(HttpError);
    expect(captureException).toHaveBeenCalledWith(
      expect.any(HttpError),
      expect.objectContaining({
        tags: expect.objectContaining({ kind: "fetch", phase: "http", status: 500 }),
      })
    );
  });

  it("captures network rejections", async () => {
    const netErr = new Error("network down");
    mockFetch(() => Promise.reject(netErr));
    await expect(fetchJson("/api/x", { feature: "t" })).rejects.toBe(netErr);
    expect(captureException).toHaveBeenCalledWith(
      netErr,
      expect.objectContaining({ tags: expect.objectContaining({ phase: "network" }) })
    );
  });

  it("does not capture a fetch canceled by its caller", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new DOMException("The operation was aborted", "AbortError");
    mockFetch(() => Promise.reject(abortError));

    await expect(fetchJson("/api/x", { signal: controller.signal, feature: "test" })).rejects.toBe(
      abortError
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does not capture a timed out fetch (transient, not an app fault)", async () => {
    const controller = new AbortController();
    const timeoutError = new DOMException("The operation timed out", "TimeoutError");
    Object.defineProperty(controller.signal, "reason", { value: timeoutError });
    controller.abort();
    const abortError = new DOMException("The operation was aborted", "AbortError");
    mockFetch(() => Promise.reject(abortError));

    await expect(fetchJson("/api/x", { signal: controller.signal, feature: "test" })).rejects.toBe(
      abortError
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does not capture a browser network drop", async () => {
    for (const message of ["Failed to fetch", "Load failed"]) {
      const netErr = new TypeError(message);
      mockFetch(() => Promise.reject(netErr));
      await expect(fetchJson("/api/x", { feature: "t" })).rejects.toBe(netErr);
    }
    expect(captureException).not.toHaveBeenCalled();
  });

  it("throws gateway statuses without capturing them", async () => {
    for (const status of [502, 503, 504]) {
      mockFetch(() => new Response("<html>bad gateway</html>", { status }));
      const err = await fetchJson("/api/x", { feature: "t" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(status);
    }
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("fetchJson error envelope", () => {
  it("exposes code, ref and server message on HttpError", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ error: "Slow down", code: "RATE_LIMITED", ref: "r1" }), {
          status: 429,
        })
    );
    const err = await fetchJson("/api/x").catch((e) => e);
    expect(err).toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      ref: "r1",
      serverMessage: "Slow down",
    });
  });
});
