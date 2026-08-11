import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(
    (retryAfter?: number) =>
      new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Retry-After": String(retryAfter ?? 60) },
      })
  ),
}));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineCorpDissolved: vi.fn().mockReturnValue("Corp dissolved headline"),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/corporations/releaseHeldSharesToFloat", () => ({
  releaseCorporationHeldSharesToFloat: vi.fn().mockResolvedValue(undefined),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  // Pre-initialize collections
  db.collection("bonds");
  db.collection("corporateSectors");
  db.collection("centralBanks");
  db.collection("characters");
  db.collection("corporations");
  db.collection("bondHistory");
  db.collection("shareOrders");
  db.collection("unownedSectors");
});

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);
}

function makeBasicAuth(userId: string) {
  return { ok: true, user: { userId } };
}

describe("POST /api/corporations/[id]/bond-default/dissolve", () => {
  it("returns 401 when not authenticated", async () => {
    await setup();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default/dissolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    await setup();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(
      makeBasicAuth(new ObjectId().toString()) as never
    );

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: false,
      retryAfter: 45,
      limit: 100,
      remaining: 0,
      resetAt: Date.now() + 45_000,
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default/dissolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("45");
  });

  it("returns 403 when user is not CEO", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: corpId, ceoId: new ObjectId() },
    } as any);

    const { requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(requireCeo).mockReturnValue(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as any
    );

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default/dissolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(403);
  });

  it("returns 400 for national corporations", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: corpId, ceoId: new ObjectId(userId), countryOwnerId: new ObjectId() },
    } as any);
    vi.mocked(requireCeo).mockReturnValue(null);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default/dissolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("National corporations");
  });

  it("returns 400 when no bonds are defaulted", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: corpId, ceoId: new ObjectId(userId) },
    } as any);
    vi.mocked(requireCeo).mockReturnValue(null);

    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [
        { _id: new ObjectId(), corporationId: corpId, matured: false, defaulted: false },
      ],
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default/dissolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
  });

  it("successfully dissolves corporation and pays creditors", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId1 = new ObjectId();
    const charId2 = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        ceoId: new ObjectId(userId),
        name: "Test Corp",
        liquidCapital: 100000,
        headquartersState: "US_CA",
        shareholders: [
          { characterId: charId1, shares: 100 },
          { characterId: charId2, shares: 50 },
        ],
      },
    } as any);
    vi.mocked(requireCeo).mockReturnValue(null);

    // Defaulted bonds
    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          matured: false,
          defaulted: true,
          totalIssued: 50000,
          holders: [
            { characterId: charId1, units: 50 },
            { characterId: charId2, units: 50 },
          ],
        },
      ],
    });

    // Corporate sectors
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          countryId: "US",
          stateId: "MN",
          sectorType: "energy",
          revenue: 1_500_000,
          workers: 500,
          profitMargin: 35,
          currentGrowthRate: 1,
          targetGrowthRate: 1,
          currentGrowthCost: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [{ _id: corpId, countryId: "US", liquidCurrencyCode: "USD" }],
      }),
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.centralBanks.find.mockReturnValue({ toArray: async () => [] });

    // Shareholder characters (first find call)
    db.collectionMocks.characters.find
      .mockReturnValueOnce({
        toArray: async () => [
          { _id: charId1, name: "Alice" },
          { _id: charId2, name: "Bob" },
        ],
      })
      // Currency lookup (second find call) — project().toArray() chain
      .mockReturnValueOnce({
        project: vi.fn().mockReturnValue({
          toArray: async () => [
            { _id: charId1, countryId: "US" },
            { _id: charId2, countryId: "US" },
          ],
        }),
      });

    // Mock bulkWrite and other operations
    db.collectionMocks.characters.bulkWrite = vi.fn().mockResolvedValue({});
    db.collectionMocks.corporations.bulkWrite = vi.fn().mockResolvedValue({});
    db.collectionMocks.bondHistory.deleteMany = vi.fn().mockResolvedValue({});
    db.collectionMocks.bonds.deleteMany = vi.fn().mockResolvedValue({});
    db.collectionMocks.shareOrders.deleteMany = vi.fn().mockResolvedValue({});
    db.collectionMocks.shareOrders.find = vi.fn().mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.shareOrders.updateMany = vi.fn().mockResolvedValue({});
    db.collectionMocks.unownedSectors.findOneAndUpdate = vi.fn().mockResolvedValue(null);
    db.collectionMocks.corporateSectors.deleteMany = vi.fn().mockResolvedValue({ deletedCount: 1 });
    db.collectionMocks.corporations.deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default/dissolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.bondRecoveryPool).toBeDefined();
    expect(data.shareholderPool).toBeDefined();
    expect(data.shareholderPayouts).toBeDefined();
    expect(data.message).toContain("Test Corp");
    expect(data.message).toContain("dissolved");

    // Verify cleanup operations were called
    expect(db.collectionMocks.bonds.deleteMany).toHaveBeenCalled();
    expect(db.collectionMocks.corporations.deleteOne).toHaveBeenCalledWith({ _id: corpId });
    expect(db.collectionMocks.unownedSectors.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.corporateSectors.deleteMany).toHaveBeenCalledWith({
      _id: {
        $in: [expect.any(Object)],
      },
    });
  });

  it("returns 400 when body validation fails", async () => {
    await setup();
    const userId = new ObjectId().toString();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default/dissolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // Missing confirm field
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
  });

  it("returns 409 when a settlement lock is already held", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: corpId, ceoId: new ObjectId(userId) },
    } as any);
    vi.mocked(requireCeo).mockReturnValue(null);

    db.collectionMocks.corporations.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default/dissolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(409);
  });
});
