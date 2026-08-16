import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  CAPACITY_ANCHOR_YEAR,
  CAPACITY_BUILD_TURNS,
  CAPACITY_FOUNDING_DISCOUNT,
  capacityPricePerUnit,
} from "@/lib/constants/capacityEconomy";
import { DEFAULT_SECTOR_STARTING_REVENUE } from "@/lib/constants/corporations";
import { foundingStarterUnits, sectorEntryFeeAnchor } from "@/lib/corporations/foundingPlant";

/**
 * P3b: founding a sector under plants is a FIRST BUILD.
 *
 * Under plants capacity is bought, so founding charges an era-scaled entry fee
 * PLUS a one-facility starter build priced through `computeBuildCost` at
 * CAPACITY_FOUNDING_DISCOUNT. The capacity arrives on a queue rather than
 * existing, and it is drawn out of the unowned pool instead of being minted.
 *
 * The non-plants path must be untouched (modern fee still applies when the
 * world preset is modern / default).
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
  getSectorHostFxRate: vi.fn().mockResolvedValue(1),
  resolveCorpLiquidCurrencyCode: vi.fn().mockReturnValue("USD"),
  resolveSectorHostCurrencyCode: vi.fn().mockReturnValue("USD"),
  anchorToCorpLiquidCapital: vi.fn((anchor: number) => anchor),
  corpLiquidCapitalToAnchor: vi.fn((local: number) => local),
}));
vi.mock("@/lib/currency/corpEconomyFields", () => ({
  writeCorpEconomicLocal: vi.fn((value: number) => value),
}));
vi.mock("@/lib/currency/sectorFxSpread", () => ({
  corpToSectorCountrySpread: vi.fn().mockReturnValue({ spreadAnchor: 0, from: null, to: null }),
}));
vi.mock("@/lib/currency/marketMaker", () => ({
  safeDistributeConversionSpread: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/corporations/techTree/featureFlag", () => ({
  isSectorTechTreesEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/corporations/sectorGrowthCost", () => ({
  resolveCountryPrimeRate: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/corporations/capexTxLog", () => ({
  emitBuildCapexTx: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("plants"),
  marketAtLeast: vi.fn().mockReturnValue(true),
}));

let db: MockDb;
const CORP_ID = new ObjectId();
const STATE_ID = "CA";
const CURRENT_TURN = 1000;

const corporation = {
  _id: CORP_ID,
  name: "Foundco",
  sequentialId: 7,
  countryId: "US",
  type: "manufacturing",
  secondaryType: "agriculture",
  ceoId: new ObjectId(),
  liquidCapital: 100_000_000,
  liquidCurrencyCode: "USD",
};

async function wireMocks(plants: boolean) {
  const { marketAtLeast } = await import("@/lib/market/featureFlag");
  vi.mocked(marketAtLeast).mockReturnValue(plants);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({ ok: true, user: { userId: "user-1" } } as never);
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);

  db.collectionMocks.states.findOne.mockResolvedValue({
    _id: STATE_ID,
    countryId: "US",
    name: "California",
  });
  // No existing sector in this state.
  db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);
  db.collectionMocks.corporateSectors.insertOne.mockResolvedValue({
    insertedId: new ObjectId(),
    acknowledged: true,
  });
  db.collectionMocks.corporations.updateOne.mockResolvedValue({
    matchedCount: 1,
    modifiedCount: 1,
  });
  db.collectionMocks.unownedSectors.updateOne.mockResolvedValue({
    matchedCount: 1,
    modifiedCount: 1,
  });
  db.collectionMocks.characters.findOne.mockResolvedValue(null);
  db.collectionMocks.stateMetrics.findOne.mockResolvedValue(null);
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    _id: "current",
    currentTurn: CURRENT_TURN,
    currentYear: CAPACITY_ANCHOR_YEAR,
  });
}

function request(sectorType?: string) {
  return new Request("http://localhost/api/corporations/1/sectors", {
    method: "POST",
    body: JSON.stringify({ stateId: STATE_ID, ...(sectorType ? { sectorType } : {}) }),
  });
}

const params = Promise.resolve({ id: CORP_ID.toString() });

/** The document the command inserted into corporateSectors. */
function insertedSector(): Record<string, unknown> {
  return db.collectionMocks.corporateSectors.insertOne.mock.calls[0][0] as Record<string, unknown>;
}

/** ₳ charged to the corp (the mocked FX is 1:1, so anchor == local). */
function chargedAnchor(): number {
  const call = db.collectionMocks.corporations.updateOne.mock.calls[0];
  const inc = (call[1] as { $inc: { liquidCapital: number } }).$inc;
  return -inc.liquidCapital;
}

// One-facility starter + modern-preset entry fee (mock gameState has no preset).
const STARTER_UNITS = foundingStarterUnits("manufacturing");
const ENTRY_FEE_ANCHOR = sectorEntryFeeAnchor("2019-default");
const STARTER_BUILD_ANCHOR =
  STARTER_UNITS *
  capacityPricePerUnit("manufacturing", CAPACITY_ANCHOR_YEAR, 1) *
  CAPACITY_FOUNDING_DISCOUNT;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  db.collection("corporateSectors");
  db.collection("unownedSectors");
  db.collection("states");
  db.collection("characters");
  db.collection("stateMetrics");
  db.collection("gameState");
});

describe("expandSector — founding build (plants)", () => {
  it("founds the corporation's secondary sector type when requested", async () => {
    await wireMocks(true);
    const { expandSector } = await import("./expandSector");
    const res = await expandSector(request("agriculture"), { params });

    expect(res.status).toBe(201);
    expect(insertedSector().sectorType).toBe("agriculture");
    const queue = insertedSector().buildQueue as Array<Record<string, number>>;
    expect(queue[0].unitsOrdered).toBe(foundingStarterUnits("agriculture"));
    expect(db.collectionMocks.unownedSectors.updateOne.mock.calls[0][0]).toEqual({
      stateId: STATE_ID,
      sectorType: "agriculture",
    });
  });

  it("writes a starter-quantum nameplate, not the ₳1M legacy grant (ticket #1027)", async () => {
    await wireMocks(true);
    const { expandSector } = await import("./expandSector");
    const { revenuePerCapacityUnit } = await import("@/lib/constants/capacityEconomy");
    const res = await expandSector(request(), { params });
    expect(res.status).toBe(201);
    const doc = insertedSector();
    // A founding sector owns 0 capacity for its whole build window and
    // sectorTurn never restates a zero-capacity nameplate, so this figure
    // persists ~17 turns and feeds market share / dominance. It must be what
    // the starter build will be worth, not DEFAULT_SECTOR_STARTING_REVENUE.
    expect(doc.revenue).toBe(
      Math.round(STARTER_UNITS * revenuePerCapacityUnit("manufacturing", 1))
    );
    expect(doc.revenue).toBeLessThan(DEFAULT_SECTOR_STARTING_REVENUE / 10);
  });

  it("builds sector types outside the corporation's primary and secondary types (any type is buildable)", async () => {
    await wireMocks(true);
    const { expandSector } = await import("./expandSector");
    const res = await expandSector(request("energy"), { params });

    expect(res.status).toBe(201);
    expect(insertedSector().sectorType).toBe("energy");
  });

  it("charges the entry fee PLUS a founding-discounted starter build", async () => {
    await wireMocks(true);
    const { expandSector } = await import("./expandSector");
    const res = await expandSector(request(), { params });
    expect(res.status).toBe(201);

    expect(chargedAnchor()).toBeCloseTo(ENTRY_FEE_ANCHOR + STARTER_BUILD_ANCHOR, 2);
  });

  it("sizes the starter to one manufacturing facility, not a $1M/day nameplate", async () => {
    await wireMocks(true);
    const { expandSector } = await import("./expandSector");
    await expandSector(request(), { params });

    expect(STARTER_UNITS).toBe(25);
    expect(chargedAnchor()).toBeCloseTo(ENTRY_FEE_ANCHOR + STARTER_BUILD_ANCHOR, 2);
    // One facility must stay far below the old 400k all-in founding bill.
    expect(chargedAnchor()).toBeLessThan(150_000);
  });

  it("creates the sector with zero capacity and the starter order queued", async () => {
    await wireMocks(true);
    const { expandSector } = await import("./expandSector");
    await expandSector(request(), { params });

    const doc = insertedSector();
    expect(doc.capitalStock).toBe(0);
    expect(doc.plantsStartTurn).toBe(CURRENT_TURN);
    expect(doc.constructionInProgressAnchor).toBe(Math.round(STARTER_BUILD_ANCHOR));

    const queue = doc.buildQueue as Array<Record<string, number>>;
    expect(queue).toHaveLength(1);
    expect(queue[0].unitsOrdered).toBeCloseTo(STARTER_UNITS, 6);
    expect(queue[0].costPaidAnchor).toBeCloseTo(STARTER_BUILD_ANCHOR, 2);
    expect(queue[0].startTurn).toBe(CURRENT_TURN);
  });

  it("delivers the founding build in HALF the standing build time", async () => {
    await wireMocks(true);
    const { expandSector } = await import("./expandSector");
    await expandSector(request(), { params });

    const queue = insertedSector().buildQueue as Array<Record<string, number>>;
    expect(queue[0].onlineTurn).toBe(
      CURRENT_TURN + Math.ceil(CAPACITY_BUILD_TURNS("manufacturing") / 2)
    );
    expect(queue[0].onlineTurn - CURRENT_TURN).toBeLessThan(CAPACITY_BUILD_TURNS("manufacturing"));
  });

  it("draws the starter capacity DOWN from the unowned pool", async () => {
    await wireMocks(true);
    const { expandSector } = await import("./expandSector");
    await expandSector(request(), { params });

    const call = db.collectionMocks.unownedSectors.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ stateId: STATE_ID, sectorType: "manufacturing" });
    // Pipeline update, TWO stages. Units are the authoritative leg and are drawn
    // down (clamped >= 0) in stage 1; `revenue` is then RESTATED from the
    // post-draw units in stage 2 via the shared `unownedPoolTrailingSet`, rather
    // than being subtracted from independently — two separately-clamped legs
    // drift apart permanently once either bottoms out.
    const stages = call[1] as Array<{ $set: Record<string, unknown> }>;
    const drawStage = stages[0].$set;
    expect(JSON.stringify(drawStage.headroomUnits)).toContain(String(STARTER_UNITS));
    expect(JSON.stringify(drawStage.headroomUnits)).toContain("$max");
    expect(drawStage.revenue).toBeUndefined();

    const trailingStage = stages[1].$set;
    expect(JSON.stringify(trailingStage.revenue)).toContain("$headroomUnits");
  });

  it("emits a capex build leg for the starter build only (not the entry fee)", async () => {
    await wireMocks(true);
    const { emitBuildCapexTx } = await import("@/lib/corporations/capexTxLog");
    const { expandSector } = await import("./expandSector");
    await expandSector(request(), { params });

    expect(emitBuildCapexTx).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(emitBuildCapexTx).mock.calls[0][1];
    expect(arg.direction).toBe("build");
    expect(arg.anchorAmount).toBeCloseTo(STARTER_BUILD_ANCHOR, 2);
    expect(arg.units).toBeCloseTo(STARTER_UNITS, 6);
    expect(arg.sectorId).toBeInstanceOf(ObjectId);
  });
});

describe("expandSector — cross-border founding", () => {
  it("looks the state up by _id alone, not scoped to the corp's home country", async () => {
    await wireMocks(true);
    const { expandSector } = await import("./expandSector");
    await expandSector(request(), { params });

    const filter = db.collectionMocks.states.findOne.mock.calls[0][0] as Record<string, unknown>;
    expect(filter).toEqual({ _id: STATE_ID });
    expect(filter.countryId).toBeUndefined();
  });

  it("founds a sector in a FOREIGN country and stamps it with the host country", async () => {
    await wireMocks(true);
    // Corp is home in US (see `corporation` mock); the target state is in the UK.
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: STATE_ID,
      name: "England",
      countryId: "UK",
    });
    const { expandSector } = await import("./expandSector");
    const res = await expandSector(request(), { params });
    expect(res.status).toBe(201);
    expect(insertedSector().countryId).toBe("UK");
  });
});

describe("expandSector — non-plants path is unchanged", () => {
  it("charges only the flat entry fee and queues nothing", async () => {
    await wireMocks(false);
    const { expandSector } = await import("./expandSector");
    const res = await expandSector(request(), { params });
    expect(res.status).toBe(201);

    expect(chargedAnchor()).toBe(ENTRY_FEE_ANCHOR);
    const doc = insertedSector();
    expect(doc.buildQueue).toBeUndefined();
    expect(doc.capitalStock).toBeUndefined();
    expect(doc.plantsStartTurn).toBeUndefined();
    // Free starting revenue, exactly as before.
    expect(doc.revenue).toBe(DEFAULT_SECTOR_STARTING_REVENUE);
  });

  it("does not touch the unowned pool or the capex ledger", async () => {
    await wireMocks(false);
    const { emitBuildCapexTx } = await import("@/lib/corporations/capexTxLog");
    const { expandSector } = await import("./expandSector");
    await expandSector(request(), { params });

    expect(db.collectionMocks.unownedSectors.updateOne).not.toHaveBeenCalled();
    expect(emitBuildCapexTx).not.toHaveBeenCalled();
  });
});
