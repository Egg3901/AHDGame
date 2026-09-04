import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  CAPACITY_ANCHOR_YEAR,
  CAPACITY_BUILD_CANCEL_REFUND,
  CAPACITY_BUILD_TURNS,
  computeBuildCost,
} from "@/lib/constants/capacityEconomy";
import { DOMINANCE_DENSITY_CROWDED_COMPETITORS } from "@/lib/constants/corporations";

/**
 * P3a: the capacity command surface — build, cancel (partial refund),
 * mothball/reactivate — plus the plants gate that fences all of it off below
 * the tier.
 */

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  resolveCorpLiquidCurrencyCode: vi.fn().mockReturnValue("USD"),
  anchorToCorpLiquidCapital: vi.fn((anchor: number) => anchor),
  corpLiquidCapitalToAnchor: vi.fn((local: number) => local),
}));
vi.mock("@/lib/currency/sectorFxSpread", () => ({
  corpToSectorCountrySpread: vi.fn().mockReturnValue({ spreadAnchor: 0, from: null, to: null }),
}));
vi.mock("@/lib/currency/marketMaker", () => ({
  safeDistributeConversionSpread: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/corporations/marketShare", () => ({
  fetchSectorMarketSharePercent: vi.fn().mockResolvedValue(0),
  // Crowded, so these cases price at the undiscounted dominance toll and the
  // hand-computed expectations below are unaffected by the density scaling.
  fetchSectorCompetitorCount: vi.fn().mockResolvedValue(DOMINANCE_DENSITY_CROWDED_COMPETITORS),
}));
vi.mock("@/lib/corporations/sectorGrowthCost", () => ({
  resolveCountryPrimeRate: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/corporations/economicActionLog", () => ({
  logEconomicAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemMode: vi.fn().mockResolvedValue("plants"),
  isMarketSystemMode: (m: string) => typeof m === "string",
  marketAtLeast: vi.fn().mockReturnValue(true),
}));

let db: MockDb;
const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();
const CURRENT_TURN = 1000;

const corporation = {
  _id: CORP_ID,
  name: "Plantsco",
  countryId: "US",
  type: "manufacturing",
  ceoId: new ObjectId(),
  liquidCapital: 100_000_000,
  liquidCurrencyCode: "USD",
};

function sectorDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: SECTOR_ID,
    corporationId: CORP_ID,
    countryId: "US",
    stateId: "US-CA",
    sectorType: "manufacturing",
    revenue: 1_000_000,
    ...overrides,
  };
}

async function wireMocks(sector: Record<string, unknown>) {
  // Re-assert the plants gate: `vi.clearAllMocks()` clears call history but
  // keeps implementations, so the "fenced off below plants" case would
  // otherwise poison every later test in the file.
  const { marketAtLeast } = await import("@/lib/market/featureFlag");
  vi.mocked(marketAtLeast).mockReturnValue(true);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({ ok: true, user: { userId: "user-1" } } as never);
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);
  db.collectionMocks.corporateSectors.findOne.mockResolvedValue(sector);
  db.collectionMocks.corporateSectors.updateOne.mockResolvedValue({
    matchedCount: 1,
    modifiedCount: 1,
  });
  db.collectionMocks.corporations.updateOne.mockResolvedValue({
    matchedCount: 1,
    modifiedCount: 1,
  });
  db.collectionMocks.characters.findOne.mockResolvedValue(null);
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    _id: "current",
    currentTurn: CURRENT_TURN,
    currentYear: CAPACITY_ANCHOR_YEAR,
  });
}

function request(body: unknown) {
  return new Request("http://localhost/api/corporations/1/sectors/2/build", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: CORP_ID.toString(), sectorId: SECTOR_ID.toString() });

/** The `$set` the command wrote to corporateSectors. */
function sectorSet(): Record<string, unknown> {
  const call = db.collectionMocks.corporateSectors.updateOne.mock.calls[0];
  return (call?.[1] as { $set: Record<string, unknown> }).$set;
}

/** The pipeline stages the command sent to the unowned pool. */
function poolPipeline(): Array<{ $set: Record<string, unknown> }> {
  const call = db.collectionMocks.unownedSectors.updateOne.mock.calls[0];
  return call?.[1] as Array<{ $set: Record<string, unknown> }>;
}

describe("buildCapacity — build", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("characters");
    db.collection("gameState");
    db.collection("gameConfig");
    db.collection("unownedSectors");
  });

  // ─── unowned-pool drawdown (#1145) ──────────────────────────────────────
  //
  // Building on an EXISTING plant used to leave the pool untouched, so every
  // post-founding unit counted as owned while its demand stayed claimable. The
  // pie read "unowned" on a market that was already built out.

  it("draws the ordered units down from the unowned pool", async () => {
    await wireMocks(sectorDoc());
    const { buildCapacity } = await import("./buildCapacity");
    await buildCapacity(request({ action: "build", units: 1_000 }), { params });

    const call = db.collectionMocks.unownedSectors.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ stateId: "US-CA", sectorType: "manufacturing" });
    expect(call[2]).toEqual({ upsert: true });
    // Negative delta, clamped so a pool smaller than the order cannot go under.
    expect(JSON.stringify(poolPipeline()[0].$set.headroomUnits)).toContain("-1000");
    expect(JSON.stringify(poolPipeline()[0].$set.headroomUnits)).toContain("$max");
    // `revenue` is restated FROM the post-draw units in its own stage.
    expect(JSON.stringify(poolPipeline()[1].$set.revenue)).toContain("$headroomUnits");
  });

  it("pauses new Retail capacity during the demand unwind", async () => {
    await wireMocks(sectorDoc({ sectorType: "retail" }));
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      retailDemandTransitionStartTurn: CURRENT_TURN - 48,
      retailDemandTransitionTurns: 192,
    });
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "build", units: 1_000 }), { params });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("144 turns remaining");
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("does not touch the pool when the order never queues", async () => {
    // The queue write is the commit point. If it loses its CAS the money is
    // handed back, so the market claim must not stand either.
    await wireMocks(sectorDoc());
    db.collectionMocks.corporateSectors.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "build", units: 1_000 }), { params });
    expect(res.status).toBe(409);
    expect(db.collectionMocks.unownedSectors.updateOne).not.toHaveBeenCalled();
  });

  it("previews without drawing the pool down", async () => {
    await wireMocks(sectorDoc());
    const { buildCapacity } = await import("./buildCapacity");
    await buildCapacity(request({ action: "build", units: 500, preview: true }), { params });
    expect(db.collectionMocks.unownedSectors.updateOne).not.toHaveBeenCalled();
  });

  it("still queues the order when the pool write fails", async () => {
    // Post-commit and best-effort: the cash and the queue write have landed, so
    // a pool failure must not 500 the caller into re-ordering.
    await wireMocks(sectorDoc());
    db.collectionMocks.unownedSectors.updateOne.mockRejectedValue(new Error("pool down"));
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "build", units: 1_000 }), { params });
    expect(res.status).toBe(201);
  });

  it("queues an order, charges computeBuildCost and tracks CIP", async () => {
    await wireMocks(sectorDoc());
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "build", units: 1_000 }), { params });
    expect(res.status).toBe(201);

    const expected = computeBuildCost({
      eraUnitScale: 1,
      sectorType: "manufacturing",
      units: 1_000,
      year: CAPACITY_ANCHOR_YEAR,
      marketSharePercent: 0,
      primeRate: 0,
    });
    const body = (await res.json()) as Record<string, number>;
    expect(body.costAnchor).toBe(Math.round(expected.totalAnchor));
    expect(body.onlineTurn).toBe(CURRENT_TURN + CAPACITY_BUILD_TURNS("manufacturing"));

    const set = sectorSet();
    const queue = set.buildQueue as Array<Record<string, number>>;
    expect(queue.length).toBe(1);
    expect(queue[0].unitsOrdered).toBe(1_000);
    expect(queue[0].costPaidAnchor).toBeCloseTo(expected.totalAnchor, 6);
    expect(set.constructionInProgressAnchor).toBe(Math.round(expected.totalAnchor));

    // Cash left the corp.
    const inc = db.collectionMocks.corporations.updateOne.mock.calls[0][1] as {
      $inc: { liquidCapital: number };
    };
    expect(inc.$inc.liquidCapital).toBeCloseTo(-expected.totalAnchor, 6);
  });

  it("previews without charging or queueing", async () => {
    await wireMocks(sectorDoc());
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "build", units: 500, preview: true }), {
      params,
    });
    expect(res.status).toBe(200);
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a build the corp cannot afford", async () => {
    await wireMocks(sectorDoc());
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { ...corporation, liquidCapital: 1 },
    } as never);
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "build", units: 1_000 }), { params });
    expect(res.status).toBe(400);
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
  });

  it("rejects non-positive and absurd unit counts", async () => {
    await wireMocks(sectorDoc());
    const { buildCapacity } = await import("./buildCapacity");
    expect((await buildCapacity(request({ action: "build", units: 0 }), { params })).status).toBe(
      400
    );
    expect(
      (await buildCapacity(request({ action: "build", units: 1e15 }), { params })).status
    ).toBe(400);
  });

  it("is fenced off below the plants tier", async () => {
    await wireMocks(sectorDoc());
    const { marketAtLeast } = await import("@/lib/market/featureFlag");
    vi.mocked(marketAtLeast).mockReturnValue(false);
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "build", units: 10 }), { params });
    expect(res.status).toBe(400);
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
  });
});

describe("buildCapacity — cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("characters");
    db.collection("gameState");
    db.collection("unownedSectors");
  });

  const outstanding = {
    unitsOrdered: 1_000,
    costPaidAnchor: 400_000,
    startTurn: 990,
    onlineTurn: CURRENT_TURN + 50,
  };

  it("returns the cancelled units to the unowned pool", async () => {
    await wireMocks(
      sectorDoc({ buildQueue: [outstanding], constructionInProgressAnchor: 400_000 })
    );
    const { buildCapacity } = await import("./buildCapacity");
    await buildCapacity(request({ action: "cancel", orderIndex: 0 }), { params });

    // A legacy (non-smooth) order has delivered nothing, so the whole claim
    // comes back: a positive delta, not the build's negative one.
    const headroom = JSON.stringify(poolPipeline()[0].$set.headroomUnits);
    expect(headroom).toContain("1000");
    expect(headroom).not.toContain("-1000");
  });

  it("returns only the UNDELIVERED units of a half-built smooth order", async () => {
    // Delivered capacity stays in `capitalStock` and keeps counting against
    // market share, so returning the full order would resurrect headroom the
    // corp is still occupying.
    await wireMocks(
      sectorDoc({
        buildQueue: [{ ...outstanding, startTurn: CURRENT_TURN - 50, smooth: true }],
        constructionInProgressAnchor: 400_000,
      })
    );
    const { buildCapacity } = await import("./buildCapacity");
    await buildCapacity(request({ action: "cancel", orderIndex: 0 }), { params });
    expect(JSON.stringify(poolPipeline()[0].$set.headroomUnits)).toContain("500");
  });

  it("removes the order and refunds the documented share — never all of it", async () => {
    await wireMocks(
      sectorDoc({ buildQueue: [outstanding], constructionInProgressAnchor: 400_000 })
    );
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "cancel", orderIndex: 0 }), { params });
    expect(res.status).toBe(200);

    const expectedRefund = 400_000 * CAPACITY_BUILD_CANCEL_REFUND;
    expect(expectedRefund).toBeLessThan(400_000);
    const inc = db.collectionMocks.corporations.updateOne.mock.calls[0][1] as {
      $inc: { liquidCapital: number };
    };
    expect(inc.$inc.liquidCapital).toBe(Math.round(expectedRefund));

    const set = sectorSet();
    expect(set.buildQueue).toEqual([]);
    expect(set.constructionInProgressAnchor).toBe(0);
  });

  it("refunds only the UNDELIVERED share of a half-built smooth order", async () => {
    // Half-way through its window: 50% of capacity is already delivered and
    // kept. Cancelling must refund 75% of the remaining HALF, not of the whole.
    const halfBuilt = {
      unitsOrdered: 1_000,
      costPaidAnchor: 400_000,
      startTurn: 940,
      onlineTurn: 1_060, // (1000 − 940) / (1060 − 940) = 0.5 delivered
      smooth: true,
    };
    await wireMocks(sectorDoc({ buildQueue: [halfBuilt], constructionInProgressAnchor: 200_000 }));
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "cancel", orderIndex: 0 }), { params });
    expect(res.status).toBe(200);

    const undelivered = 400_000 * 0.5;
    const expectedRefund = undelivered * CAPACITY_BUILD_CANCEL_REFUND;
    const inc = db.collectionMocks.corporations.updateOne.mock.calls[0][1] as {
      $inc: { liquidCapital: number };
    };
    expect(inc.$inc.liquidCapital).toBe(Math.round(expectedRefund));
    // Strictly less than refunding the whole order's undelivered-as-if-full.
    expect(expectedRefund).toBeLessThan(400_000 * CAPACITY_BUILD_CANCEL_REFUND);
    expect(sectorSet().buildQueue).toEqual([]);
  });

  it("refuses to cancel a build that already landed", async () => {
    await wireMocks(sectorDoc({ buildQueue: [{ ...outstanding, onlineTurn: CURRENT_TURN - 1 }] }));
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "cancel", orderIndex: 0 }), { params });
    expect(res.status).toBe(400);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("404s on an unknown order index", async () => {
    await wireMocks(sectorDoc({ buildQueue: [] }));
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "cancel", orderIndex: 3 }), { params });
    expect(res.status).toBe(404);
  });

  it("refunds nothing for the free flip-compensation order", async () => {
    await wireMocks(sectorDoc({ buildQueue: [{ ...outstanding, costPaidAnchor: 0 }] }));
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "cancel", orderIndex: 0 }), { params });
    expect(res.status).toBe(200);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });
});

describe("buildCapacity — mothball / reactivate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("characters");
    db.collection("gameState");
  });

  it("mothballs an active sector", async () => {
    await wireMocks(sectorDoc());
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "mothball" }), { params });
    expect(res.status).toBe(200);
    expect(sectorSet().mothballed).toBe(true);
    // Free: no cash movement either way.
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("reactivates a mothballed sector for free, with no cooldown", async () => {
    await wireMocks(sectorDoc({ mothballed: true }));
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "reactivate" }), { params });
    expect(res.status).toBe(200);
    expect(sectorSet().mothballed).toBe(false);
  });

  it("rejects a no-op toggle", async () => {
    await wireMocks(sectorDoc({ mothballed: true }));
    const { buildCapacity } = await import("./buildCapacity");
    const res = await buildCapacity(request({ action: "mothball" }), { params });
    expect(res.status).toBe(400);
  });
});

// ─── unowned-pool country attribution (#1271) ─────────────────────────────
//
// The pool row is keyed by state and sector, but it CARRIES a countryId that
// every reader filters on. A sector with no stored countryId resolved it from
// the corporation and then fell through to a literal "US", so a US-domiciled
// corp building in a foreign state minted a pool row filed under the United
// States: unreachable to the country the capacity is physically in, and counted
// as American headroom by the sector browser and the commodity supply math.
describe("buildCapacity — unowned pool country attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("characters");
    db.collection("gameState");
    db.collection("gameConfig");
    db.collection("unownedSectors");
    db.collection("states");
  });

  it("files the pool row under the country the STATE is in, not the corp's", async () => {
    await wireMocks(sectorDoc({ countryId: undefined, stateId: "UKR_WES" }));
    db.collectionMocks.states.findOne.mockResolvedValue({ _id: "UKR_WES", countryId: "UKR" });

    const { buildCapacity } = await import("./buildCapacity");
    await buildCapacity(request({ action: "build", units: 100 }), { params });

    expect(JSON.stringify(poolPipeline()[0].$set.countryId)).toContain("UKR");
    expect(JSON.stringify(poolPipeline()[0].$set.countryId)).not.toContain('"US"');
  });

  it("prefers the state even over a countryId already stored on the sector", async () => {
    // The precedence `getSectorOperatingCountryId` sets for the rest of the
    // codebase. A stored country left stale by a region changing hands is the
    // case that helper exists for, so taking it first would reintroduce this
    // bug in its other form. Fails on the old order, which read the sector's
    // value first and never looked at the state.
    await wireMocks(sectorDoc({ countryId: "US", stateId: "UKR_WES" }));
    db.collectionMocks.states.findOne.mockResolvedValue({ _id: "UKR_WES", countryId: "UKR" });

    const { buildCapacity } = await import("./buildCapacity");
    await buildCapacity(request({ action: "build", units: 100 }), { params });

    expect(JSON.stringify(poolPipeline()[0].$set.countryId)).toContain("UKR");
    expect(JSON.stringify(poolPipeline()[0].$set.countryId)).not.toContain('"US"');
  });

  it("never falls back to a hardcoded country when nothing else resolves", async () => {
    // Sector country cleared and no state row, so the OLD chain reached its
    // `?? "US"` literal. The corporation is Polish here, so "PL" proves the
    // literal is gone rather than coincidentally agreeing with it.
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    await wireMocks(sectorDoc({ countryId: undefined, stateId: "PL_MAZ" }));
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { ...corporation, countryId: "PL" },
    } as never);
    db.collectionMocks.states.findOne.mockResolvedValue(null);

    const { buildCapacity } = await import("./buildCapacity");
    await buildCapacity(request({ action: "build", units: 100 }), { params });

    expect(JSON.stringify(poolPipeline()[0].$set.countryId)).toContain("PL");
    expect(JSON.stringify(poolPipeline()[0].$set.countryId)).not.toContain('"US"');
  });
});
