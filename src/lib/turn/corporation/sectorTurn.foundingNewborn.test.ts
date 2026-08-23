import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector, SectorBuildOrder } from "@/lib/db/types";
import { buildMarketContext } from "@/lib/market/marketContext";
import { CAPACITY_ANCHOR_YEAR, CAPACITY_BUILD_TURNS } from "@/lib/constants/capacityEconomy";
import type { CorporationLookups } from "./types";
import { processSector, type SectorTurnEnv } from "./sectorTurn";
import { applySectorTurnOps } from "./applySectorTurnOps";

/**
 * P3b: the FIRST plants turn of a newly founded sector.
 *
 * `expandSector` (and the NPP founding path) now create a sector with
 * `capitalStock: 0` and the founding build sitting in `buildQueue`. That shape
 * did not exist before — every plants sector previously arrived through the flip
 * migration with capacity already on the books. This pins the two things that
 * have to be true of a zero-capacity newborn:
 *
 *   1. it produces NOTHING (no capacity, no output, no revenue conjured from a
 *      nameplate the plants engine is supposed to have stopped believing);
 *   2. it does not explode — no NaN, no divide-by-zero from the mix-price and
 *      utilization maths, and the queued order survives to its online turn.
 */

const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();
const STATE_ID = "US-CA";
const COUNTRY_ID = "US";
const FOUNDED_TURN = 1000;
const BUILD_TURNS = Math.ceil(CAPACITY_BUILD_TURNS("manufacturing") / 2);

function makeCorp(): Corporation {
  return {
    _id: CORP_ID,
    name: "Foundco",
    countryId: COUNTRY_ID,
    sectorType: "manufacturing",
    liquidCapital: 10_000_000,
    createdAt: new Date(),
  } as unknown as Corporation;
}

/** A sector exactly as `expandSector` founds it under plants. */
function newbornSector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  const starter: SectorBuildOrder = {
    unitsOrdered: 5_000,
    costPaidAnchor: 300_000,
    startTurn: FOUNDED_TURN,
    onlineTurn: FOUNDED_TURN + BUILD_TURNS,
  };
  return {
    _id: SECTOR_ID,
    corporationId: CORP_ID,
    stateId: STATE_ID,
    countryId: COUNTRY_ID,
    sectorType: "manufacturing",
    strategyId: "standard",
    // The legacy nameplate the founding flow still writes for non-plants
    // readers. Plants must NOT pay out on it.
    revenue: 1_000_000,
    profitMargin: 35,
    currentGrowthRate: 0,
    targetGrowthRate: 0,
    currentGrowthCost: 0,
    productionPolicy: 0,
    productionPolicyLevel: 0,
    workers: 500,
    capitalStock: 0,
    buildQueue: [starter],
    constructionInProgressAnchor: 300_000,
    plantsStartTurn: FOUNDED_TURN,
    createdAt: new Date(),
    ...overrides,
  } as unknown as CorporateSector;
}

function makeLookups(): CorporationLookups {
  return {
    corporations: [],
    sectorsByCorp: new Map(),
    corpById: new Map(),
    ceoBusinessAcumenByCorpId: new Map(),
    bondsByCorpId: new Map(),
    bondsHeldByCorpId: new Map(),
    portfolioAnchorValueByCorpId: new Map(),
    bondAndImfPortfolioAnchorByCorpId: new Map(),
    issuedBondDebtByCorpId: new Map(),
    crossCorpStockHoldingsByHolderCorpId: new Map(),
    primeRateByCountry: new Map(),
    macroInflationByCountry: new Map(),
    investorConfidenceByCountry: new Map(),
    macroDebtToGdpByCountry: new Map(),
    macroDeficitByCountry: new Map(),
    sovereignDefaultMarginByCorpId: new Map(),
    marketShareBySectorId: new Map(),
    allTariffs: [],
    activeFtaPairs: new Set(),
    ftaCoverage: { byCountryEconomyWide: new Map(), bySectorType: new Map() },
    activeSubsidies: [],
    priceRatioByCommodity: new Map(),
    globalCommodityBalances: new Map(),
    stateInputAvailabilityByState: new Map(),
    nationalCommodityBalancesByCountry: new Map(),
    rawStateBalances: new Map(),
    extractionCapacityUtilBySector: new Map(),
    stateResourceCapacityByState: new Map(),
    stateSectorSpecializationByState: new Map(),
    rawWorkforceSkillByState: new Map(),
    labourTightnessByState: new Map(),
    regionalConditionMarginByState: new Map(),
    sectorPresenceKeys: new Set(),
    exportIntensityByCountry: new Map(),
    activeDisasterEffectsByState: new Map(),
    politicalBoardByState: new Map(),
  } as unknown as CorporationLookups;
}

function makeEnv(currentTurn: number): SectorTurnEnv {
  return {
    lookups: makeLookups(),
    turn: currentTurn,
    currentTurn,
    now: new Date("2026-08-01T00:00:00Z"),
    techTreesEnabled: false,
    currentYear: CAPACITY_ANCHOR_YEAR,
    labour: { wagesEnabled: false },
    market: buildMarketContext("plants"),
    wageIndexByState: new Map(),
    automationIndexByState: new Map(),
    labourDemandByState: new Map(),
    pendingStrikeEvents: [],
    pendingCapacityBindingEvents: [],
    sectorOps: [],
  } as unknown as SectorTurnEnv;
}

function run(sector: CorporateSector, currentTurn: number) {
  const env = makeEnv(currentTurn);
  const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
  const op = env.sectorOps[0] as { updateOne: { update: { $set?: Record<string, unknown> } } };
  return {
    result,
    update: op.updateOne.update.$set ?? {},
    // C4: buildQueue/CIP are written as a delta, not a $set — read them off the
    // document the ops produce.
    doc: applySectorTurnOps(sector as unknown as Record<string, unknown>, env.sectorOps),
  };
}

describe("plants — a newly founded, zero-capacity sector", () => {
  it("produces no revenue while its founding build is still under way", () => {
    const { update } = run(newbornSector(), FOUNDED_TURN + 1);
    expect(update.revenue as number).toBe(0);
  });

  it("does not explode: every written number stays finite", () => {
    const { update } = run(newbornSector(), FOUNDED_TURN + 1);
    for (const [key, value] of Object.entries(update)) {
      if (typeof value === "number") {
        expect(Number.isFinite(value), `${key} = ${value}`).toBe(true);
      }
    }
    expect(update.capitalStock as number).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(update.capitalStock as number)).toBe(true);
  });

  it("keeps the founding order queued and its cash reported as CIP", () => {
    const { doc } = run(newbornSector(), FOUNDED_TURN + 1);
    const queue = doc.buildQueue as SectorBuildOrder[];
    expect(queue).toHaveLength(1);
    expect(queue[0].unitsOrdered).toBe(5_000);
    expect(doc.constructionInProgressAnchor).toBe(300_000);
  });

  it("turns the founding order into real capacity on its online turn", () => {
    const online = FOUNDED_TURN + BUILD_TURNS;
    const { update, doc } = run(newbornSector(), online);
    // Capacity lands (depreciation applies the same turn, so just assert it is
    // now a real, positive stock) and the CIP releases.
    expect(update.capitalStock as number).toBeGreaterThan(0);
    expect(doc.buildQueue as SectorBuildOrder[]).toEqual([]);
    expect(doc.constructionInProgressAnchor).toBe(0);
  });

  it("earns revenue only once the capacity exists", () => {
    const online = FOUNDED_TURN + BUILD_TURNS;
    const { update } = run(newbornSector(), online);
    expect(update.revenue as number).toBeGreaterThan(0);
    expect(Number.isFinite(update.revenue as number)).toBe(true);
  });
});

/**
 * The zero-revenue trap (advisor report 2026-08-06, sandbox PA sector).
 *
 * Every test above starts each turn from a FRESH newborn carrying its founding
 * nameplate, so none of them ever fed a persisted `revenue: 0` back in. That is
 * the whole bug: `plantsMixPrice` used to be `revenue / impliedUnits`, which is
 * 0/0 at revenue 0, so the first build-window turn wrote `revenue: 0` and every
 * turn after that priced the sector's output at $0, forever, even once real
 * capacity landed. The player saw a sector producing thousands of units, selling
 * 100% of them, and booking $0 revenue against $0 costs.
 *
 * This runs the sector FORWARD through its own persisted state, which is the
 * only shape that reproduces it.
 */
describe("plants, a newborn survives its own build window", () => {
  /** Run consecutive turns, feeding each turn's written doc into the next. */
  function runForward(fromTurn: number, toTurn: number, overrides: Partial<CorporateSector> = {}) {
    let doc = newbornSector(overrides) as unknown as Record<string, unknown>;
    const revenueByTurn: number[] = [];
    for (let turn = fromTurn; turn <= toTurn; turn++) {
      const env = makeEnv(turn);
      processSector(env, makeCorp(), doc as unknown as CorporateSector, 1, undefined, 1);
      doc = applySectorTurnOps(doc, env.sectorOps);
      revenueByTurn.push(doc.revenue as number);
    }
    return { doc, revenueByTurn };
  }

  it("prices its output even while its nameplate sits at zero", () => {
    // One turn in, capacity is still 0 so the nameplate is legitimately 0.
    const { doc } = runForward(FOUNDED_TURN + 1, FOUNDED_TURN + 1);
    expect(doc.revenue as number).toBe(0);
    // Two turns in, reading revenue 0 back, the mix price must NOT collapse.
    // With capacity still 0 the nameplate stays 0, but the sector must not have
    // lost the ability to price anything, which is what the next case proves.
    const online = FOUNDED_TURN + BUILD_TURNS;
    const { doc: built } = runForward(FOUNDED_TURN + 1, online);
    expect(built.capitalStock as number).toBeGreaterThan(0);
    expect(built.revenue as number).toBeGreaterThan(0);
  });

  it("does not sell real units at a zero price once the build lands", () => {
    const { doc } = runForward(FOUNDED_TURN + 1, FOUNDED_TURN + BUILD_TURNS + 2);
    const produced = doc.producedUnits as number;
    const realized = doc.realizedRevenue as number;
    expect(produced).toBeGreaterThan(0);
    // The trap's signature: units move, money does not.
    expect(realized).toBeGreaterThan(0);
    expect(realized / produced).toBeGreaterThan(0);
  });

  it("never gets stuck: a sector already at revenue 0 with capacity heals", () => {
    // The state live sandbox sectors are in right now, capacity on the books,
    // nameplate zeroed by the old formula. One turn must restore it.
    const stuck = newbornSector({
      revenue: 0,
      capitalStock: 5_000,
      buildQueue: [],
      constructionInProgressAnchor: 0,
    });
    const { update } = run(stuck, FOUNDED_TURN + BUILD_TURNS + 5);
    expect(update.revenue as number).toBeGreaterThan(0);
  });

  // The advisor's actual sector was EXTRACTION (Meyer Extraction, Pennsylvania),
  // not manufacturing. Extraction runs a different production leg
  // (`plantsExtractionHardMin` off deposit capacity) but is priced by the same
  // `plantsMixPrice`, so it hit the identical trap. Pin the extraction path so a
  // future change to either leg cannot silently reintroduce a $0 extractor.
  it("heals an extraction sector too (the reported sector type)", () => {
    const online = FOUNDED_TURN + BUILD_TURNS;
    const { doc } = runForward(FOUNDED_TURN + 1, online + 2, {
      sectorType: "extraction",
      strategyId: "standard",
    });
    expect(doc.capitalStock as number).toBeGreaterThan(0);
    expect(doc.revenue as number).toBeGreaterThan(0);
    const produced = doc.producedUnits as number;
    const realized = doc.realizedRevenue as number;
    expect(produced).toBeGreaterThan(0);
    expect(realized).toBeGreaterThan(0);
  });

  it("heals a STUCK extraction sector already at revenue 0 with capacity", () => {
    const stuck = newbornSector({
      sectorType: "extraction",
      strategyId: "standard",
      revenue: 0,
      capitalStock: 5_000,
      buildQueue: [],
      constructionInProgressAnchor: 0,
    });
    const { update } = run(stuck, FOUNDED_TURN + BUILD_TURNS + 5);
    expect(update.revenue as number).toBeGreaterThan(0);
  });
});
