import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { POST } from "./route";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/api/rateLimit.mongo", () => ({
  durableRateLimit: vi.fn(),
  mongoRateLimit: vi.fn(),
}));

const AD_ID = new ObjectId().toString();

function viewRequest(ip?: string): Request {
  return new Request(`http://localhost/api/player-ads/${AD_ID}/view`, {
    method: "POST",
    ...(ip ? { headers: { "x-forwarded-for": ip } } : {}),
  });
}

describe("POST /api/player-ads/[id]/view", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("playerBannerAds").updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { getDb } = await import("@/lib/mongodb");
    const { getAuthUser } = await import("@/lib/auth");
    const { durableRateLimit, mongoRateLimit } = await import("@/lib/api/rateLimit.mongo");

    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(getAuthUser).mockResolvedValue(null);
    vi.mocked(durableRateLimit).mockResolvedValue({
      ok: true,
      limit: 60,
      remaining: 59,
      resetAt: Date.now() + 60_000,
    });
    vi.mocked(mongoRateLimit).mockResolvedValue({
      ok: true,
      limit: 1,
      remaining: 0,
      resetAt: Date.now() + 3_600_000,
    });
  });

  it("counts an authenticated first view", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ userId: "user-1" } as never);

    const res = await POST(viewRequest(), { params: Promise.resolve({ id: AD_ID }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true, counted: true });
    expect(db.collection("playerBannerAds").updateOne).toHaveBeenCalledOnce();
  });

  it("preserves legitimate anonymous display: counts an unauthenticated first view", async () => {
    const res = await POST(viewRequest("203.0.113.7"), {
      params: Promise.resolve({ id: AD_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true, counted: true });
    expect(db.collection("playerBannerAds").updateOne).toHaveBeenCalledOnce();
  });

  it("keys anonymous velocity by client IP and authenticated velocity by user id", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    const { durableRateLimit } = await import("@/lib/api/rateLimit.mongo");

    await POST(viewRequest("203.0.113.7"), { params: Promise.resolve({ id: AD_ID }) });
    expect(vi.mocked(durableRateLimit).mock.calls[0][0]).toBe("player-ad-view:ip:203.0.113.7");

    vi.mocked(getAuthUser).mockResolvedValue({ userId: "user-9" } as never);
    await POST(viewRequest("203.0.113.7"), { params: Promise.resolve({ id: AD_ID }) });
    expect(vi.mocked(durableRateLimit).mock.calls[1][0]).toBe("player-ad-view:user:user-9");
  });

  it("dedupes a repeat view of the same ad by the same viewer without erroring", async () => {
    const { mongoRateLimit } = await import("@/lib/api/rateLimit.mongo");
    vi.mocked(mongoRateLimit).mockResolvedValue({
      ok: false,
      limit: 1,
      remaining: 0,
      resetAt: Date.now() + 3_600_000,
      retryAfter: 3600,
    });

    const res = await POST(viewRequest("203.0.113.7"), {
      params: Promise.resolve({ id: AD_ID }),
    });
    const data = await res.json();

    // Display behavior preserved (still 200/success), but no increment.
    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true, counted: false });
    expect(db.collection("playerBannerAds").updateOne).not.toHaveBeenCalled();
  });

  it("rejects velocity abuse with 429 and does not increment", async () => {
    const { durableRateLimit } = await import("@/lib/api/rateLimit.mongo");
    vi.mocked(durableRateLimit).mockResolvedValue({
      ok: false,
      limit: 60,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfter: 60,
    });

    const res = await POST(viewRequest("203.0.113.7"), {
      params: Promise.resolve({ id: AD_ID }),
    });

    expect(res.status).toBe(429);
    expect(db.collection("playerBannerAds").updateOne).not.toHaveBeenCalled();
  });

  it("fails open to counting when the impression store is unavailable", async () => {
    const { mongoRateLimit } = await import("@/lib/api/rateLimit.mongo");
    vi.mocked(mongoRateLimit).mockRejectedValue(new Error("mongo down"));

    const res = await POST(viewRequest("203.0.113.7"), {
      params: Promise.resolve({ id: AD_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true, counted: true });
    expect(db.collection("playerBannerAds").updateOne).toHaveBeenCalledOnce();
  });

  it("returns 400 for an invalid ad id", async () => {
    const res = await POST(viewRequest("203.0.113.7"), {
      params: Promise.resolve({ id: "not-an-id" }),
    });

    expect(res.status).toBe(400);
    expect(db.collection("playerBannerAds").updateOne).not.toHaveBeenCalled();
  });
});
