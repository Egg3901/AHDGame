import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function mockDb(findOneAndUpdate: ReturnType<typeof vi.fn>) {
  return { collection: () => ({ findOneAndUpdate }) } as never;
}

describe("mongoRateLimit", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns ok with remaining when under the limit", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const findOneAndUpdate = vi.fn().mockResolvedValue({ count: 2 });
    vi.mocked(getDb).mockResolvedValue(mockDb(findOneAndUpdate));

    const { mongoRateLimit } = await import("./rateLimit.mongo");
    const res = await mongoRateLimit("ip-a", 5, 60_000);

    expect(res.ok).toBe(true);
    expect(res.limit).toBe(5);
    expect(res.remaining).toBe(3);
    // window-aligned reset in the future
    expect(res.resetAt).toBeGreaterThan(Date.now());
    // atomic increment with upsert
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.stringContaining("ip-a:") }),
      expect.objectContaining({ $inc: { count: 1 } }),
      expect.objectContaining({ upsert: true })
    );
  });

  it("returns not-ok with retryAfter when over the limit", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDb(vi.fn().mockResolvedValue({ count: 6 })));

    const { mongoRateLimit } = await import("./rateLimit.mongo");
    const res = await mongoRateLimit("ip-b", 5, 60_000);

    expect(res.ok).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.retryAfter).toBeGreaterThan(0);
  });
});

describe("durableRateLimit", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("fast-rejects on the in-memory limiter without touching Mongo", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { durableRateLimit } = await import("./rateLimit.mongo");

    // maxRequests 0 => the very first local check is already over the limit.
    const res = await durableRateLimit("ip-local-reject", 0, 60_000);

    expect(res.ok).toBe(false);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("falls back to the local result if the durable store throws", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockRejectedValue(new Error("db down"));
    const { durableRateLimit } = await import("./rateLimit.mongo");

    // Generous limit so the local check passes; Mongo then errors -> fail open.
    const res = await durableRateLimit("ip-fail-open", 100, 60_000);

    expect(res.ok).toBe(true);
    expect(getDb).toHaveBeenCalled();
  });
});
