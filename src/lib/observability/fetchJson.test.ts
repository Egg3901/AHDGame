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
});
