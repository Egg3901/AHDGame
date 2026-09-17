/**
 * Tests for POST /api/corporations/[id]/bond-default/restructure
 * (issue #1672): the CEO-initiated restructure settles through the shared
 * bondRestructureSpend primitive (sector liquidation, guarded corp debit,
 * one resumable credit per holder, per-bond maturity claims), so these tests
 * assert the public Idempotency-Key contract — missing key, invalid key,
 * replay, conflict, recovery after the final cure, terminal mapping — plus
 * the preserved historical HTTP errors.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/corporations/settlementLock", () => ({
  withCorporationSettlementLock: vi.fn(
    async (
      _db: unknown,
      _corpId: unknown,
      _field: unknown,
      _now: unknown,
      run: () => Promise<unknown>
    ) => run()
  ),
}));
// Sector liquidation runs before the money flow but is a route-boundary
// dependency (it pulls the market strategy tables in); the executor tests
// own its mechanics. Mock the passthrough so these tests own the keyed
// settlement contract.
vi.mock("@/lib/corporations/restoreSectorsToUnowned", () => ({
  restoreSectorsToUnowned: vi.fn().mockResolvedValue({
    sectorsProcessed: 1,
    sectorsDeleted: 1,
    poolsUpdated: 1,
    totalRevenueRestored: 0,
  }),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn().mockResolvedValue(undefined),
  wireHeadlineCorpRestructured: vi.fn(() => "RESTRUCTURING"),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 444 }),
}));
vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: vi.fn().mockResolvedValue(false),
}));
// Era unit scale is orthogonal to restructure settlement: pin the leaf like
// the executor tests do instead of resolving the world-seed graph.
vi.mock("@/lib/currency/gdpAnchorRate", () => ({
  loadWorldEraUnitScale: vi.fn().mockResolvedValue(1),
}));

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const name of [
    "bonds",
    "corporations",
    "corporateSectors",
    "centralBanks",
    "characters",
    "imperialCharacters",
    "nonAtomicMoneyFlowReceipts",
    "exchangeRates",
  ]) {
    db.collection(name);
  }
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString() },
  } as never);
  const { checkRateLimit } = await import("@/lib/api/rateLimit");
  vi.mocked(checkRateLimit).mockReturnValue({
    ok: true,
    limit: 100,
    remaining: 99,
    resetAt: Date.now() + 60_000,
  });
  const { requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(requireCeo).mockReturnValue(null);
});

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

/**
 * One DEFAULTED USD bond, 10 units x $1k face = 10_000 principal held by a
 * single character. The corp holds 1_000 liquid, so restructuring must
 * liquidate sectors to raise the remaining 9_000.
 */
async function setupRestructureFixture(overrides: Record<string, unknown> = {}) {
  const corpId = new ObjectId();
  const charId = new ObjectId();
  const sectorId = new ObjectId();
  const corporation = {
    _id: corpId,
    name: "Debtor Corp",
    countryId: "US",
    liquidCapital: 1_000,
    liquidCurrencyCode: "USD",
    ...overrides,
  };
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);
  db.collectionMocks["corporations"]!.findOne.mockResolvedValue(corporation as never);

  const bond = {
    _id: new ObjectId(),
    corporationId: corpId,
    currencyCode: "USD",
    matured: false,
    defaulted: true,
    couponRate: 5,
    marketPrice: 0.4,
    totalIssued: 10_000,
    publicFloat: 0,
    holders: [{ characterId: charId, units: 10 }],
  };
  db.collectionMocks["bonds"]!.find.mockImplementation(() => makeCursor([bond]));

  // Two sectors: the last-sector guard forbids liquidating a corp's ONLY
  // sector (that is a dissolution, not a restructure), so the fixture keeps
  // one survivor while the other covers the 9_000 shortfall.
  const sectorIdB = new ObjectId();
  db.collectionMocks["corporateSectors"]!.find.mockReturnValue(
    makeCursor([
      {
        _id: sectorId,
        corporationId: corpId,
        countryId: "US",
        stateId: "US-CA",
        revenue: 1_000_000,
        maintenance: 0,
      },
      {
        _id: sectorIdB,
        corporationId: corpId,
        countryId: "US",
        stateId: "US-CA",
        revenue: 1_000_000,
        maintenance: 0,
      },
    ])
  );
  db.collectionMocks["centralBanks"]!.find.mockReturnValue(makeCursor([]));
  db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
  db.collectionMocks["characters"]!.find.mockReturnValue({
    project: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: charId, countryId: "US", name: "Alice" }]),
    }),
  });
  db.collectionMocks["imperialCharacters"]!.find.mockReturnValue({
    project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
  });
  return { corpId, charId, sectorId, bond, corporation };
}

function postRestructure(corpId: ObjectId, headers: Record<string, string> = {}) {
  return import("./route").then(({ POST }) =>
    POST(
      new Request(`http://localhost/api/corporations/${corpId.toString()}/bond-default/restructure`, {
        method: "POST",
        headers: { ...headers },
      }),
      { params: Promise.resolve({ id: corpId.toString() }) }
    )
  );
}

describe("POST /api/corporations/[id]/bond-default/restructure — Idempotency-Key contract", () => {
  it("settles a feasible restructure and reports the stored outcome shape", async () => {
    const f = await setupRestructureFixture();

    const res = await postRestructure(f.corpId, { "Idempotency-Key": "restructure-route-ok" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      paid: number;
      bondsMatured: number;
      sectorsLiquidated: number;
      proceeds: number;
      residualLiquidCapital: number;
    };
    expect(body.success).toBe(true);
    expect(body.paid).toBe(10_000);
    expect(body.bondsMatured).toBe(1);
    expect(body.sectorsLiquidated).toBeGreaterThan(0);
  });

  it("settles without an Idempotency-Key, claiming a minted receipt", async () => {
    const f = await setupRestructureFixture();

    const res = await postRestructure(f.corpId);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { success: boolean }).success).toBe(true);

    const receiptInsert = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!.insertOne.mock
      .calls[0]![0] as { _id: string };
    expect(typeof receiptInsert._id).toBe("string");
    expect(receiptInsert._id.length).toBeGreaterThan(0);
  });

  it("rejects an empty or overlong Idempotency-Key without touching money", async () => {
    const f = await setupRestructureFixture();

    for (const key of ["", "x".repeat(129)]) {
      const res = await postRestructure(f.corpId, { "Idempotency-Key": key });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(
        "Invalid Idempotency-Key header"
      );
    }
    expect(db.collectionMocks["nonAtomicMoneyFlowReceipts"]!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
  });

  it("replays the same key without paying again", async () => {
    const f = await setupRestructureFixture();
    const headers = { "Idempotency-Key": "restructure-route-replay" };

    const first = await postRestructure(f.corpId, headers);
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    const fingerprint = (receipts.insertOne.mock.calls[0]?.[0] as { fingerprint: string })
      .fingerprint;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "restructure-route-replay",
      status: "completed",
      fingerprint,
    });

    const corpWrites = db.collectionMocks["corporations"]!.updateOne.mock.calls.length;
    const second = await postRestructure(f.corpId, headers);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
    expect(db.collectionMocks["corporations"]!.updateOne.mock.calls.length).toBe(corpWrites);
  });

  it("maps a reused key for a different restructure to 409 without paying", async () => {
    const f = await setupRestructureFixture();
    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "restructure-route-conflict",
      status: "completed",
      fingerprint: "bond-restructure:something-else",
    });

    const res = await postRestructure(f.corpId, { "Idempotency-Key": "restructure-route-conflict" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("different restructure");
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
  });

  it("recovers the stored outcome after the final cure when the live set reads empty", async () => {
    const f = await setupRestructureFixture();
    const headers = { "Idempotency-Key": "restructure-route-final-cure" };

    // A genuinely completed first attempt, captured so the retry below can
    // replay its exact stored plan. Reporting the completed receipt back as
    // `in_progress` models the crash window precisely: every write applied,
    // the completion write lost, every bond cured so the live set is empty.
    const first = await postRestructure(f.corpId, headers);
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    const firstInsert = receipts.insertOne.mock.calls[0]?.[0] as {
      _id: string;
      fingerprint: string;
    };
    const planUpdate = receipts.updateOne.mock.calls.find(
      (call) => (call[1] as { $set?: { bondRestructurePlan?: unknown } }).$set?.bondRestructurePlan
    );
    expect(planUpdate).toBeDefined();

    db.collectionMocks["bonds"]!.find.mockImplementation(() => makeCursor([]));
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: firstInsert._id,
      status: "in_progress",
      fingerprint: firstInsert.fingerprint,
      bondRestructurePlan: (planUpdate![1] as { $set: { bondRestructurePlan: unknown } }).$set
        .bondRestructurePlan,
    });

    const retry = await postRestructure(f.corpId, headers);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(firstBody);
    const settled = receipts.updateOne.mock.calls.filter(
      (call) => (call[1] as { $set?: { status?: string } }).$set?.status === "completed"
    );
    expect(settled.length).toBeGreaterThan(0);
  });

  it("maps a settled failed receipt to 409", async () => {
    const f = await setupRestructureFixture();
    const headers = { "Idempotency-Key": "restructure-route-terminal" };
    // Force a cure claim to lose its race: the first attempt compensates its
    // prefix and settles terminally behind the 400 bond-state surface. A
    // retry under the same key must fail closed, not re-attempt.
    db.collectionMocks["bonds"]!.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    } as never);
    const failed = await postRestructure(f.corpId, headers);
    expect(failed.status).toBe(400);

    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    const fingerprint = (receipts.insertOne.mock.calls[0]?.[0] as { fingerprint: string })
      .fingerprint;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "restructure-route-terminal",
      status: "compensated",
      fingerprint,
    });

    const res = await postRestructure(f.corpId, headers);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("already settled");
  });

  it("preserves the no-default 400 without a key", async () => {
    const f = await setupRestructureFixture();
    db.collectionMocks["bonds"]!.find.mockImplementation(() => makeCursor([]));

    const res = await postRestructure(f.corpId);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "No defaulted bonds to restructure"
    );
    expect(db.collectionMocks["nonAtomicMoneyFlowReceipts"]!.insertOne).not.toHaveBeenCalled();
  });

  it("preserves the national-corporation 400", async () => {
    const f = await setupRestructureFixture({ countryOwnerId: new ObjectId() });

    const res = await postRestructure(f.corpId);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Not available for national corporations"
    );
  });

  it("preserves the game-state 503", async () => {
    const f = await setupRestructureFixture();
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValueOnce(null as never);

    const res = await postRestructure(f.corpId);
    expect(res.status).toBe(503);
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
  });

  it("preserves the insufficient-sector-value 400", async () => {
    const f = await setupRestructureFixture();
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([]));

    const res = await postRestructure(f.corpId);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Insufficient sector value");
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
  });

  it("preserves the settlement-lock 409", async () => {
    const f = await setupRestructureFixture();
    const { withCorporationSettlementLock } = await import(
      "@/lib/corporations/settlementLock"
    );
    vi.mocked(withCorporationSettlementLock).mockResolvedValueOnce(null);

    const res = await postRestructure(f.corpId);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("already in progress");
  });
});
