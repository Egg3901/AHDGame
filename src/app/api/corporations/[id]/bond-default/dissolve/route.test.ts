import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

// Warm the route's (large) import graph at collection time: the executor
// wiring pulls in the money-flow primitive and its collaborators, whose
// first transform can otherwise exceed a single test's timeout and flake
// the earliest tests in this file.
await import("./route");

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
vi.mock("@/lib/db/transactionSupport", () => ({
  // Standalone path: run the REAL keyed dissolution flow the way a
  // non-replica-set deployment does (mirrors the cash-route key tests).
  assertTransactionSupportAtBoot: vi.fn().mockResolvedValue(false),
}));
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

/**
 * Idempotency-Key contract for the CEO dissolve route (issue #1672): the
 * payout waterfall runs as exactly-once money flow under the client's key
 * (minted when absent). A retry with the same key replays the stored
 * outcome — including after the corporation is already gone, when the route
 * answers from the completed receipt instead of 404ing. Settled or foreign
 * keys stay loud (409); a key mismatch on the corp-gone path falls through
 * to the historical 404.
 */
describe("POST /api/corporations/[id]/bond-default/dissolve — Idempotency-Key", () => {
  beforeEach(() => {
    // Isolate receipt mocks between key tests: the outer beforeEach only
    // clears calls, not the findOne/insertOne behaviors set below.
    db.collection("nonAtomicMoneyFlowReceipts");
    const receipts = db.collectionMocks.nonAtomicMoneyFlowReceipts;
    receipts.insertOne.mockReset();
    receipts.findOne.mockReset();
    receipts.updateOne.mockReset();
    receipts.insertOne.mockResolvedValue({ insertedId: "507f1f77bcf86cd799439011" });
    receipts.findOne.mockResolvedValue(null);
    receipts.updateOne.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });
  });

  async function setupKeyFixture() {
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();

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
        name: "Key Corp",
        countryId: "US",
        liquidCapital: 500_000,
        totalShares: 100,
        shareholders: [],
      },
    } as never);
    vi.mocked(requireCeo).mockReturnValue(null);

    // The bond row is built once: the executor fingerprints bond _ids, so a
    // per-call factory would fork the fingerprint on every retry and turn
    // replays into key conflicts.
    const bond = {
      _id: new ObjectId(),
      corporationId: corpId,
      matured: false,
      defaulted: true,
      totalIssued: 100_000,
      couponRate: 5,
      holders: [{ characterId: charId, units: 100 }],
      publicFloat: 0,
    };
    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [bond],
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.centralBanks.find.mockReturnValue({ toArray: async () => [] });
    return { corpId, charId };
  }

  function postDissolve(id: string, headers?: Record<string, string>) {
    return import("./route").then(({ POST }) =>
      POST(
        new Request(`http://localhost/api/corporations/${id}/bond-default/dissolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(headers ?? {}) },
          body: JSON.stringify({ confirm: true }),
        }),
        { params: Promise.resolve({ id }) }
      )
    );
  }

  it("rejects an empty or overlong Idempotency-Key without touching money", async () => {
    await setup();
    await setupKeyFixture();

    for (const key of ["", "x".repeat(129)]) {
      const res = await postDissolve(new ObjectId().toHexString(), { "Idempotency-Key": key });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(
        "Invalid Idempotency-Key header"
      );
    }
    expect(
      db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne
    ).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("settles under a minted key when no Idempotency-Key is sent", async () => {
    await setup();
    const { corpId } = await setupKeyFixture();

    const res = await postDissolve(corpId.toHexString());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { success: boolean }).success).toBe(true);

    // No client key: the attempt is still crash-safe within itself, keyed
    // under a minted id rather than a client-supplied one.
    const receipts = db.collectionMocks.nonAtomicMoneyFlowReceipts;
    const minted = receipts.insertOne.mock.calls[0]?.[0] as { _id: string };
    expect(typeof minted._id).toBe("string");
    expect(minted._id.length).toBeGreaterThan(0);
  });

  it("replays the same Idempotency-Key without moving money again", async () => {
    await setup();
    const { corpId } = await setupKeyFixture();
    const headers = { "Idempotency-Key": "dissolve-replay" };

    const first = await postDissolve(corpId.toHexString(), headers);
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const receipts = db.collectionMocks.nonAtomicMoneyFlowReceipts;
    const fingerprint = (receipts.insertOne.mock.calls[0]?.[0] as { fingerprint: string })
      .fingerprint;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "dissolve-replay",
      status: "completed",
      fingerprint,
    });

    const holderWrites = db.collectionMocks.characters.updateOne.mock.calls.length;
    const second = await postDissolve(corpId.toHexString(), headers);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
    expect(db.collectionMocks.characters.updateOne.mock.calls.length).toBe(holderWrites);
  });

  it("maps a reused key for a different dissolution to 409 without moving money", async () => {
    await setup();
    const { corpId } = await setupKeyFixture();
    const headers = { "Idempotency-Key": "dissolve-conflict" };

    const first = await postDissolve(corpId.toHexString(), headers);
    expect(first.status).toBe(200);

    const receipts = db.collectionMocks.nonAtomicMoneyFlowReceipts;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "dissolve-conflict",
      status: "completed",
      fingerprint: "bond-dissolution:something-else-entirely",
    });

    const res = await postDissolve(corpId.toHexString(), headers);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("different dissolution");
  });

  it("maps a settled failed receipt to 409 without moving money again", async () => {
    await setup();
    const { corpId } = await setupKeyFixture();
    const headers = { "Idempotency-Key": "dissolve-terminal" };

    const first = await postDissolve(corpId.toHexString(), headers);
    expect(first.status).toBe(200);

    const receipts = db.collectionMocks.nonAtomicMoneyFlowReceipts;
    const fingerprint = (receipts.insertOne.mock.calls[0]?.[0] as { fingerprint: string })
      .fingerprint;
    const holderWrites = db.collectionMocks.characters.updateOne.mock.calls.length;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "dissolve-terminal",
      status: "failed",
      fingerprint,
    });

    const res = await postDissolve(corpId.toHexString(), headers);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("already settled");
    expect(db.collectionMocks.characters.updateOne.mock.calls.length).toBe(holderWrites);
  });

  it("replays from the completed receipt after the corporation is already gone", async () => {
    await setup();
    const corpIdHex = new ObjectId().toHexString();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(
      makeBasicAuth(new ObjectId().toString()) as never
    );
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
    // The terminal cleanup deleted the corporation: the lookup fails before
    // the executor runs.
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Corporation not found" }), { status: 404 }),
    } as never);
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);

    const outcome = {
      corpIdHex,
      corpName: "Key Corp",
      bondRecoveryPool: 100_000,
      shareholderPool: 400_000,
      shareholderPayouts: [],
      corporateShareholderPayouts: [],
      publicFloatPayout: null,
      totalPayoutToPeople: 100_000,
    };
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue({
      _id: "dissolve-gone",
      status: "completed",
      fingerprint: "bond-dissolution:gone",
      bondDissolutionPlan: {
        version: 1,
        corpIdHex,
        holders: [],
        funds: [],
        pools: [],
        outcome,
      },
    });

    const res = await postDissolve(corpIdHex, { "Idempotency-Key": "dissolve-gone" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.bondRecoveryPool).toBe(100_000);
    expect(body.shareholderPool).toBe(400_000);
    expect(body.totalPayoutToPeople).toBe(100_000);
  });

  it("stays loud with 409 on a terminal receipt after the corporation is gone", async () => {
    await setup();
    const corpIdHex = new ObjectId().toHexString();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(
      makeBasicAuth(new ObjectId().toString()) as never
    );
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Corporation not found" }), { status: 404 }),
    } as never);
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue({
      _id: "dissolve-gone-terminal",
      status: "failed",
      fingerprint: "bond-dissolution:gone-terminal",
    });

    const res = await postDissolve(corpIdHex, { "Idempotency-Key": "dissolve-gone-terminal" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("already settled");
  });

  it("falls through to 404 on a key mismatch after the corporation is gone", async () => {
    await setup();
    const corpIdHex = new ObjectId().toHexString();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(
      makeBasicAuth(new ObjectId().toString()) as never
    );
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Corporation not found" }), { status: 404 }),
    } as never);
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    // A completed receipt for a DIFFERENT corp: with no corp doc left a hex
    // mismatch is indistinguishable from a retry on a different URL form, so
    // the route keeps the historical 404.
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue({
      _id: "dissolve-gone-mismatch",
      status: "completed",
      fingerprint: "bond-dissolution:other",
      bondDissolutionPlan: {
        version: 1,
        corpIdHex: new ObjectId().toHexString(),
        holders: [],
        funds: [],
        pools: [],
        outcome: {
          corpIdHex: "other",
          corpName: "Other Corp",
          bondRecoveryPool: 1,
          shareholderPool: 2,
          shareholderPayouts: [],
          corporateShareholderPayouts: [],
          publicFloatPayout: null,
          totalPayoutToPeople: 3,
        },
      },
    });

    const res = await postDissolve(corpIdHex, { "Idempotency-Key": "dissolve-gone-mismatch" });
    expect(res.status).toBe(404);
  });
});
