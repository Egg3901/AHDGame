import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { PATREON_GRACE_PERIOD_MS } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
// Mock the write helpers but keep getGracePeriodEnd real so we can assert the
// currentPeriodEnd + grace expiry math.
vi.mock("@/lib/patreon/service", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/patreon/service")>();
  return {
    ...actual,
    applyPatreonStatus: vi.fn(),
    startPatreonGracePeriod: vi.fn(),
  };
});

const TOKEN = "test-lakeside-token";

function makeRequest(body: unknown, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers["Authorization"] = `Bearer ${token}`;
  return new Request("http://localhost/api/webhooks/lakeside-subscription", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhooks/lakeside-subscription", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.LAKESIDE_S2S_TOKEN = TOKEN;
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  afterEach(() => {
    delete process.env.LAKESIDE_S2S_TOKEN;
  });

  it("returns 401 when the bearer token is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        { email: "a@b.com", tier: "supporter", active: true, currentPeriodEnd: null },
        null
      )
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when the bearer token is wrong", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        { email: "a@b.com", tier: "supporter", active: true, currentPeriodEnd: null },
        "wrong-token"
      )
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown email", async () => {
    vi.mocked(db.collection("users").findOne).mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ email: "ghost@b.com", tier: "supporter", active: true, currentPeriodEnd: null })
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("unknown_email");
  });

  it("grants benefits with stripe provider, ad-free default, and periodEnd + grace expiry", async () => {
    const userId = new ObjectId();
    vi.mocked(db.collection("users").findOne).mockResolvedValue({ _id: userId, email: "a@b.com" });
    const service = await import("@/lib/patreon/service");

    const periodEnd = "2026-08-01T00:00:00.000Z";
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        email: "A@B.com", // mixed case: must match case-insensitively
        tier: "supporter-plus",
        active: true,
        currentPeriodEnd: periodEnd,
      })
    );

    expect(res.status).toBe(200);
    expect(service.applyPatreonStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId,
        tier: "supporter-plus",
        adsDisabledDefault: true,
        provider: "stripe",
        expiresAt: new Date(new Date(periodEnd).getTime() + PATREON_GRACE_PERIOD_MS),
      })
    );
    expect(service.startPatreonGracePeriod).not.toHaveBeenCalled();
  });

  it("grants with null expiry when currentPeriodEnd is null", async () => {
    const userId = new ObjectId();
    vi.mocked(db.collection("users").findOne).mockResolvedValue({ _id: userId, email: "a@b.com" });
    const service = await import("@/lib/patreon/service");

    const { POST } = await import("./route");
    await POST(
      makeRequest({ email: "a@b.com", tier: "supporter", active: true, currentPeriodEnd: null })
    );

    expect(service.applyPatreonStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tier: "supporter", provider: "stripe", expiresAt: null })
    );
  });

  it("starts a grace period when the subscription is inactive", async () => {
    const userId = new ObjectId();
    vi.mocked(db.collection("users").findOne).mockResolvedValue({ _id: userId, email: "a@b.com" });
    const service = await import("@/lib/patreon/service");

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        email: "a@b.com",
        tier: "supporter",
        active: false,
        currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("grace_period");
    expect(service.startPatreonGracePeriod).toHaveBeenCalledWith(expect.anything(), userId);
    expect(service.applyPatreonStatus).not.toHaveBeenCalled();
  });

  it("is idempotent: replaying the same active event applies the same state", async () => {
    const userId = new ObjectId();
    vi.mocked(db.collection("users").findOne).mockResolvedValue({ _id: userId, email: "a@b.com" });
    const service = await import("@/lib/patreon/service");

    const body = {
      email: "a@b.com",
      tier: "supporter" as const,
      active: true,
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
    };
    const { POST } = await import("./route");
    await POST(makeRequest(body));
    await POST(makeRequest(body));

    expect(service.applyPatreonStatus).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = vi.mocked(service.applyPatreonStatus).mock.calls;
    expect(firstCall[1]).toEqual(secondCall[1]);
  });
});
