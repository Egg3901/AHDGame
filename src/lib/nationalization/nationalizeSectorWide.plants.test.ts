/**
 * Plants-tier capacity conservation for the sector-wide taking.
 *
 * Under `marketSystemMode >= "plants"` a corporate sector's `revenue` is DERIVED
 * — `sectorTurn` restates it from `capitalStock × mix price` every turn. Both of
 * this file's revenue writers used to be completely un-gated, so a sector-wide
 * nationalization destroyed the seized capacity (donor row shrunk or deleted,
 * NatCorp given only a revenue number the next tick erased) and the unowned
 * headroom capture evaporated entirely.
 *
 * These tests pin the three properties that must hold:
 *   (a) below plants every write is byte identical to the pre-P3b behaviour;
 *   (b) under plants the NatCorp GAINS capitalStock and the donor LOSES the
 *       matching capacity;
 *   (c) the headroom capture lands on capacity, not only on revenue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { NATIONALIZATION_REVENUE_HAIRCUT } from "./constants";

const marketMode = { value: "capital" as string };

vi.mock("@/lib/market/featureFlag", async () => {
  const actual = await vi.importActual<typeof import("@/lib/market/featureFlag")>(
    "@/lib/market/featureFlag"
  );
  return { ...actual, getMarketSystemModeForDb: vi.fn(async () => marketMode.value) };
});
vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["USD", 1]])),
  anchorToCorpLiquidCapital: (v: number) => v,
  resolveSectorHostCurrencyCode: () => "USD",
  fxRateForSectorHostFromMap: () => 1,
}));
vi.mock("@/lib/currency/corpEconomyFields", () => ({
  readCorpEconomicAnchor: (v: number) => v,
  writeCorpEconomicLocal: (v: number) => v,
}));
vi.mock("@/lib/bonds/corporateBondDefault", () => ({
  buildPrimeRateMap: vi.fn(() => new Map()),
  computeSectorNpvSum: vi.fn(() => 1000),
}));
vi.mock("./nationalCorporation", () => ({
  resolveNationalCorporationForSector: vi.fn().mockResolvedValue({ _id: new ObjectId() }),
  isStateOwned: () => false,
}));
vi.mock("./compensation", () => ({
  applyTier: (v: number) => v,
  sectorCompensationValuationAnchor: (_s: unknown, npv: number) => npv,
}));
vi.mock("./treasury", () => ({ debitTreasuryCompensation: vi.fn().mockResolvedValue(0) }));
vi.mock("./consequences/apply", () => ({
  applyNationalizationConsequences: vi
    .fn()
    .mockResolvedValue({ confidenceBefore: 70, confidenceAfter: 68, legitimacyDelta: 0 }),
}));
vi.mock("./ledger", () => ({ recordNationalizationLedger: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/corporations/marketShare", () => ({
  gdpDerivedMarketAnchor: vi.fn((gdp: number) => gdp),
}));
vi.mock("@/lib/corporations/brandFacilityLoss", () => ({
  applyBrandFacilityLoss: vi.fn().mockResolvedValue(undefined),
}));

import { nationalizeSectorWide } from "./nationalizeSectorWide";

/** Shape of a captured `updateOne(filter, update)` call on the mock collection. */
type UpdateCall = [
  { _id: ObjectId },
  { $set?: Record<string, unknown>; $inc?: Record<string, number> },
];

function cursor<T>(rows: T[]) {
  const c = { toArray: vi.fn().mockResolvedValue(rows), project: vi.fn(() => c) };
  return c;
}

const donorCorpId = new ObjectId();
const donorSectorId = new ObjectId();

const consequence = {
  method: "legislative" as const,
  triggers: ["supermajority" as const],
  turn: 5,
};

/** A donor row with real plant state: built capacity plus one order in flight. */
function donorSector() {
  return {
    _id: donorSectorId,
    corporationId: donorCorpId,
    countryId: "US",
    stateId: "CA",
    sectorType: "technology",
    revenue: 1000,
    workers: 100,
    currentGrowthCost: 50,
    profitMargin: 20,
    capitalStock: 400,
    constructionInProgressAnchor: 90,
    buildQueue: [{ unitsOrdered: 40, costPaidAnchor: 90, onlineTurn: 9 }],
    mothballed: false,
    plantsStartTurn: 2,
  };
}

describe("nationalizeSectorWide — plants capacity conservation", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    marketMode.value = "capital";
    db = createMockDb();
    for (const n of [
      "corporateSectors",
      "corporations",
      "unownedSectors",
      "centralBanks",
      "states",
    ])
      db.collection(n);
    db.collectionMocks.centralBanks.find.mockReturnValue(cursor([]));
    db.collectionMocks.unownedSectors.find.mockReturnValue(cursor([]));
    db.collectionMocks.states.find.mockReturnValue(cursor([]));
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: donorCorpId,
      name: "Donor Co",
      liquidCurrencyCode: "USD",
      ceoType: "npp",
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor([donorSector()]));
  });

  async function run(carveFraction: number) {
    return nationalizeSectorWide(db as unknown as Db, {
      countryId: "US",
      sectorType: "technology",
      carveFraction,
      scope: "corporations",
      tier: "fair",
      consequence,
    });
  }

  /** The NatCorp create write (the only insertOne this path makes). */
  const inserted = () => db.collectionMocks.corporateSectors.insertOne.mock.calls[0][0];
  /** The donor shrink write. */
  const donorSet = () =>
    (db.collectionMocks.corporateSectors.updateOne.mock.calls as UpdateCall[]).find(
      (c) => String(c[0]._id) === String(donorSectorId)
    )![1].$set!;

  // ── (a) below plants: nothing changes ──
  it("below plants writes no plant fields on either side", async () => {
    await run(0.5);
    const ins = inserted();
    expect(ins.revenue).toBe(Math.round(1000 * 0.5 * (1 - NATIONALIZATION_REVENUE_HAIRCUT)));
    for (const k of [
      "capitalStock",
      "buildQueue",
      "constructionInProgressAnchor",
      "mothballed",
      "plantsStartTurn",
      "legacyRevenueShadow",
    ]) {
      expect(ins).not.toHaveProperty(k);
      expect(donorSet()).not.toHaveProperty(k);
    }
    // The donor shrink is exactly the three legacy legs plus updatedAt.
    expect(Object.keys(donorSet()).sort()).toEqual([
      "currentGrowthCost",
      "revenue",
      "updatedAt",
      "workers",
    ]);
  });

  // ── (b) under plants: units move, and they move ONCE ──
  it("under plants the NatCorp gains capitalStock and the donor loses the match", async () => {
    marketMode.value = "plants";
    await run(0.5);
    const ins = inserted();
    const gained = ins.capitalStock as number;
    const kept = donorSet().capitalStock as number;

    // The NatCorp gains f × stock, less the deliberate transition haircut.
    expect(gained).toBeCloseTo(400 * 0.5 * (1 - NATIONALIZATION_REVENUE_HAIRCUT), 6);
    // The donor keeps exactly the complement 1 − f.
    expect(kept).toBeCloseTo(400 * 0.5, 6);
    // CONSERVATION: gained + kept + haircut sink = the donor's original stock.
    const sink = 400 * 0.5 * NATIONALIZATION_REVENUE_HAIRCUT;
    expect(gained + kept + sink).toBeCloseTo(400, 6);

    // Buildings in flight transfer at the carve fraction and at FULL ₳ value —
    // the haircut never touches money already charged to a corp.
    expect(ins.constructionInProgressAnchor).toBeCloseTo(45, 6);
    expect(donorSet().constructionInProgressAnchor).toBeCloseTo(45, 6);
    expect((ins.buildQueue as { unitsOrdered: number; costPaidAnchor: number }[])[0]).toMatchObject(
      {
        unitsOrdered: 20,
        costPaidAnchor: 45,
      }
    );
    // The ramp anchor is inherited, not reset: this capacity has already ramped.
    expect(ins.plantsStartTurn).toBe(2);
  });

  it("a 100% taking moves all capacity and deletes the donor row", async () => {
    marketMode.value = "plants";
    await run(1);
    expect(inserted().capitalStock).toBeCloseTo(400 * (1 - NATIONALIZATION_REVENUE_HAIRCUT), 6);
    expect(inserted().constructionInProgressAnchor).toBeCloseTo(90, 6);
    expect(db.collectionMocks.corporateSectors.deleteOne).toHaveBeenCalledWith({
      _id: donorSectorId,
    });
  });

  it("folds into an existing NatCorp row by summing capacity", async () => {
    marketMode.value = "plants";
    const natRowId = new ObjectId();
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: natRowId,
      capitalStock: 100,
      buildQueue: [],
      constructionInProgressAnchor: 0,
      mothballed: false,
      plantsStartTurn: 7,
    });
    await run(0.5);
    const merged = (db.collectionMocks.corporateSectors.updateOne.mock.calls as UpdateCall[]).find(
      (c) => String(c[0]._id) === String(natRowId)
    )![1].$set!;
    expect(merged.capitalStock).toBeCloseTo(
      100 + 400 * 0.5 * (1 - NATIONALIZATION_REVENUE_HAIRCUT),
      6
    );
    // Earlier of the two ramp anchors survives the fold.
    expect(merged.plantsStartTurn).toBe(2);
  });
});

// ── (c) the unowned headroom capture must land on capacity ──
describe("nationalizeSectorWide — plants headroom capture", () => {
  let db: MockDb;
  const natRowId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    marketMode.value = "plants";
    db = createMockDb();
    for (const n of [
      "corporateSectors",
      "corporations",
      "unownedSectors",
      "centralBanks",
      "states",
    ])
      db.collection(n);
    db.collectionMocks.centralBanks.find.mockReturnValue(cursor([]));
    db.collectionMocks.unownedSectors.find.mockReturnValue(cursor([]));
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);
    // Section 1 finds nothing to carve; section 2b finds the NatCorp's own row.
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: natRowId,
          corporationId: null, // patched below to the resolved NatCorp id
          countryId: "US",
          stateId: "CA",
          sectorType: "technology",
          revenue: 400,
          strategyId: null,
        },
      ])
    );
    db.collectionMocks.states.find.mockReturnValue(
      cursor([{ _id: "CA", gdp: 1000, countryId: "US" }])
    );
  });

  it("increments capitalStock alongside revenue for captured headroom", async () => {
    await nationalizeSectorWide(db as unknown as Db, {
      countryId: "US",
      sectorType: "technology",
      carveFraction: 1,
      scope: "unowned",
      tier: "fair",
      consequence,
    });
    const call = (db.collectionMocks.corporateSectors.updateOne.mock.calls as UpdateCall[]).find(
      (c) => String(c[0]._id) === String(natRowId)
    );
    expect(call).toBeDefined();
    const inc = call![1].$inc!;
    // ceiling 1000 − owned 400 − pool 0 = 600 of headroom, taken in full.
    expect(inc.revenue).toBe(600);
    // The capture must NOT be revenue-only: without a capitalStock leg the next
    // sectorTurn restates revenue off unchanged capacity and the capture is gone.
    expect(inc.capitalStock).toBeGreaterThan(0);
  });
});

// ── (d) an absent donor must not change the survivor's operating state ──
//
// The unowned pool has no donor doc to slice, so the taking folds a SYNTHETIC
// all-zero donor into the NatCorp's existing row. `mergeSectorPlantFields` ANDs
// `mothballed`, so a hardcoded `false` on that synthetic donor silently woke a
// mothballed NatCorp sector: it started producing and paying full upkeep with
// no player action behind it.
describe("nationalizeSectorWide — mothballed survivor absorbing unowned headroom", () => {
  let db: MockDb;
  const natRowId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    marketMode.value = "plants";
    db = createMockDb();
    for (const n of [
      "corporateSectors",
      "corporations",
      "unownedSectors",
      "centralBanks",
      "states",
    ])
      db.collection(n);
    db.collectionMocks.centralBanks.find.mockReturnValue(cursor([]));
    db.collectionMocks.states.find.mockReturnValue(cursor([]));
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor([]));
    // The NatCorp already operates this (type, region) and has IDLED it.
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: natRowId,
      capitalStock: 100,
      buildQueue: [],
      constructionInProgressAnchor: 0,
      mothballed: true,
      plantsStartTurn: 7,
    });
    db.collectionMocks.unownedSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          countryId: "US",
          stateId: "CA",
          sectorType: "technology",
          revenue: 500,
        },
      ])
    );
  });

  it("stays mothballed and still absorbs the capacity", async () => {
    await nationalizeSectorWide(db as unknown as Db, {
      countryId: "US",
      sectorType: "technology",
      carveFraction: 1,
      scope: "unowned",
      tier: "fair",
      consequence,
    });
    const merged = (db.collectionMocks.corporateSectors.updateOne.mock.calls as UpdateCall[]).find(
      (c) => String(c[0]._id) === String(natRowId) && c[1].$set?.mothballed !== undefined
    )![1].$set!;
    // The survivor's own operating state is untouched by an absent donor.
    expect(merged.mothballed).toBe(true);
    // And the taking still lands: capacity grows past the survivor's own 100.
    expect(merged.capitalStock as number).toBeGreaterThan(100);
    // Every other field is the survivor's own, i.e. a true merge identity.
    expect(merged.plantsStartTurn).toBe(7);
    expect(merged.constructionInProgressAnchor).toBe(0);
  });
});
