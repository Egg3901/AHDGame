/**
 * Plants-tier capacity conservation for the single-sector / whole-corp taking.
 *
 * Under `marketSystemMode >= "plants"` a corporate sector's `revenue` is DERIVED
 * — `sectorTurn` restates it from `capitalStock × mix price` every turn — so
 * `absorbSectorIntoNatCorp` was moving nothing at all:
 *
 *   - the MERGE branch `$inc`'d revenue onto the survivor and DELETED the donor,
 *     destroying the donor's `capitalStock` / `buildQueue` / CIP / ramp anchor
 *     outright, and the survivor's revenue was restated from its own untouched
 *     capacity on the next tick. The entire seized capacity left the world.
 *   - the RE-PARENT branch applied the 15% transition haircut to `revenue` only,
 *     so the next tick restated revenue back to the full pre-taking nameplate
 *     and the transition penalty silently evaporated.
 *
 * These pin: (a) below plants every write is byte identical to the pre-fix
 * behaviour, (b) under plants capacity actually moves and (c) the haircut bites
 * on the quantity the restatement reads.
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
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  anchorToCorpLiquidCapital: (v: number) => v,
  corpLiquidCapitalToAnchor: (v: number) => v,
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["USD", 1]])),
  resolveCorpLiquidCurrencyCode: () => "USD",
  resolveSectorHostCurrencyCode: () => "USD",
  fxRateForSectorHostFromMap: () => 1,
}));
vi.mock("@/lib/currency/corpEconomyFields", () => ({
  readCorpEconomicAnchor: (v: number) => v,
  writeCorpEconomicLocal: (v: number) => v,
}));
vi.mock("@/lib/bonds/corporateBondDefault", () => ({
  buildPrimeRateMap: vi.fn(() => new Map()),
  computeSectorNpvSum: vi.fn(() => 0),
  allocateShareholderPool: vi.fn(() => ({
    characterRows: [],
    corporationRows: [],
    fundRows: [],
    publicFloatRow: null,
  })),
}));
vi.mock("./compensation", () => ({
  applyTier: () => 0,
  computeWholeCorpValuation: () => 0,
  sectorCompensationValuationAnchor: () => 0,
  wholeCorpCompensationAnchor: () => ({ valuationAnchor: 0, payoutAnchor: 0 }),
}));
vi.mock("./nationalCorporation", () => ({
  ensurePrimaryNationalCorporation: vi.fn(),
  resolveNationalCorporationForSector: vi.fn(),
}));
vi.mock("./treasury", () => ({
  debitTreasuryCompensation: vi.fn().mockResolvedValue(0),
  creditTreasuryProceeds: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./consequences/apply", () => ({
  applyNationalizationConsequences: vi
    .fn()
    .mockResolvedValue({ confidenceBefore: 70, confidenceAfter: 68, legitimacyDelta: 0 }),
}));
vi.mock("./ledger", () => ({ recordNationalizationLedger: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./concentration", () => ({
  readStateOwnershipConcentration: vi.fn().mockResolvedValue(0),
  sociMultiplier: () => 1,
}));
vi.mock("@/lib/corporations/brandFacilityLoss", () => ({
  applyBrandFacilityLoss: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentYear: 2020 }),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));

import { nationalizeSector } from "./ownershipTransition";

const KEEP = 1 - NATIONALIZATION_REVENUE_HAIRCUT;

function cursor<T>(rows: T[]) {
  const c = { toArray: vi.fn().mockResolvedValue(rows), project: vi.fn(() => c) };
  return c;
}

const natCorpId = new ObjectId();
const donorCorpId = new ObjectId();
const sectorId = new ObjectId();
const survivorId = new ObjectId();

/** The donor row being taken: 1000 units of capacity with an order in flight. */
const donorSector = {
  _id: sectorId,
  corporationId: donorCorpId,
  countryId: "CN",
  stateId: "CN-HD",
  sectorType: "energy",
  revenue: 1_000_000,
  workers: 500,
  currentGrowthCost: 0,
  capitalStock: 1000,
  constructionInProgressAnchor: 40_000,
  buildQueue: [{ unitsOrdered: 100, costPaidAnchor: 40_000, onlineTurn: 20 }],
  mothballed: false,
  plantsStartTurn: 5,
};

let db: MockDb;

async function run(existingSurvivor: Record<string, unknown> | null) {
  db = createMockDb();
  for (const n of ["corporations", "corporateSectors", "centralBanks", "characters"]) {
    db.collection(n);
  }
  db.collectionMocks.centralBanks.find.mockReturnValue(cursor([]));
  // 1st findOne = the sector being taken; 2nd = the NatCorp's existing holding.
  db.collectionMocks.corporateSectors.findOne
    .mockResolvedValueOnce(donorSector)
    .mockResolvedValueOnce(existingSurvivor);
  db.collectionMocks.corporations.findOne.mockResolvedValue({
    _id: donorCorpId,
    name: "Donor Co",
    countryId: "CN",
    liquidCapital: 0,
    liquidCurrencyCode: "USD",
  });
  const { resolveNationalCorporationForSector } = await import("./nationalCorporation");
  vi.mocked(resolveNationalCorporationForSector).mockResolvedValue({
    _id: natCorpId,
    countryId: "CN",
    countryOwnerId: "CN",
  } as never);

  await nationalizeSector(db as unknown as Db, {
    countryId: "CN",
    sectorId,
    tier: "seizure",
    consequence: { method: "executive", triggers: [], turn: 42 },
  });

  return db.collectionMocks.corporateSectors.updateOne.mock.calls[0] as [
    { _id: ObjectId },
    { $set?: Record<string, unknown>; $inc?: Record<string, number> },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  marketMode.value = "capital";
});

describe("absorbSectorIntoNatCorp — re-parent branch", () => {
  it("below plants writes only the haircut revenue and no plant field", async () => {
    const call = await run(null);
    expect(call[1].$set!.revenue).toBe(Math.round(1_000_000 * KEEP));
    // The gate matters: below plants `capitalStock` is owned and re-derived by
    // capital mode, so writing it here would fight the turn processor.
    expect(call[1].$set).not.toHaveProperty("capitalStock");
  });

  it("under plants haircuts the CAPACITY leg, so the penalty survives restatement", async () => {
    marketMode.value = "plants";
    const call = await run(null);
    expect(call[1].$set!.capitalStock).toBe(1000 * KEEP);
    // Revenue is written in lockstep off the same haircut so the two views agree
    // in the turn before `sectorTurn` next restates them.
    expect(call[1].$set!.revenue).toBe(Math.round(1_000_000 * KEEP));
    // CIP and the in-flight order are ₳ already paid — they ride across on the
    // same doc at FULL value; haircutting them would destroy money, not capacity.
    expect(call[1].$set).not.toHaveProperty("constructionInProgressAnchor");
  });
});

describe("absorbSectorIntoNatCorp — merge branch", () => {
  const survivor = {
    _id: survivorId,
    corporationId: natCorpId,
    stateId: "CN-HD",
    sectorType: "energy",
    revenue: 2_000_000,
    capitalStock: 2000,
    constructionInProgressAnchor: 10_000,
    buildQueue: [{ unitsOrdered: 10, costPaidAnchor: 10_000, onlineTurn: 9 }],
    mothballed: false,
    plantsStartTurn: 12,
  };

  it("below plants merges revenue and writes no plant field", async () => {
    const call = await run(survivor);
    expect(call[0]).toEqual({ _id: survivorId });
    expect(call[1].$inc!.revenue).toBe(Math.round(1_000_000 * KEEP));
    expect(call[1].$set).not.toHaveProperty("capitalStock");
    expect(call[1].$set).not.toHaveProperty("buildQueue");
    expect(call[1].$set).not.toHaveProperty("plantsStartTurn");
    expect(db.collectionMocks.corporateSectors.deleteOne).toHaveBeenCalledWith({ _id: sectorId });
  });

  it("under plants folds the donor's plant state into the survivor before deleting it", async () => {
    marketMode.value = "plants";
    const call = await run(survivor);
    const set = call[1].$set!;
    // Capacity is CONSERVED across the merge, less the single deliberate haircut
    // sink: survivor 2000 + donor 1000 × 0.85.
    expect(set.capitalStock).toBe(2000 + 1000 * KEEP);
    // CIP + both build orders transfer at full ₳ value, queue in landing order.
    expect(set.constructionInProgressAnchor).toBe(50_000);
    expect((set.buildQueue as { onlineTurn: number }[]).map((o) => o.onlineTurn)).toEqual([9, 20]);
    // Earlier ramp anchor wins — re-anchoring would re-clamp production the
    // donor had already ramped past.
    expect(set.plantsStartTurn).toBe(5);
    // Revenue merges in LOCKSTEP with the capacity fold, under plants too. The
    // donor row is deleted on the next line, so omitting this write does not
    // avoid a double count, it puts the donor's revenue nowhere in the world
    // for the turn until sectorTurn next restates the survivor.
    expect(call[1].$inc!.revenue).toBe(Math.round(1_000_000 * KEEP));
    expect(db.collectionMocks.corporateSectors.deleteOne).toHaveBeenCalledWith({ _id: sectorId });
  });
});
