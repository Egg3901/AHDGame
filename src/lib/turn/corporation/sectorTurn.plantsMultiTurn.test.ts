import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { CAPITAL_SEED_HEADROOM, impliedOutputUnits } from "@/lib/market/capital";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import { buildMarketContext } from "@/lib/market/marketContext";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import type { CorporationLookups } from "./types";
import { processSector, type SectorTurnEnv } from "./sectorTurn";

/**
 * MULTI-TURN stability of the plants revenue chain.
 *
 * Every other plants test runs ONE turn against a hand-built sector, which
 * cannot see a feedback defect: the question "does turn N's output become turn
 * N+1's input in a way that compounds?" only has an answer if you actually feed
 * the persisted update back in. Three audit rounds of single-turn tests missed
 * that question entirely, so this file asks it directly — it replays the SAME
 * sector for 12 consecutive turns, carrying each turn's `$set` forward, and
 * pins the resulting revenue trajectory.
 *
 * What it protects: under plants, `sector.revenue` is restated each turn as
 * `plantsCapacity × plantsMixPrice`, and `plantsMixPrice` is identically
 * 1/Σ(rate/base) — so the restatement is a function of CAPACITY ALONE and
 * carries no realization, haircut or clearing leg. Held capacity flat, revenue
 * must therefore sit at a stable positive level. If any realization-side leg
 * ever leaks into the persisted nameplate, this series turns geometric and
 * these assertions fail; the extraction case below (pinned at the 0.5 legacy
 * haircut floor, the harshest gate in the chain) would decay ~40%/turn toward
 * zero.
 */

const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();
const STATE_ID = "US-TX";
const COUNTRY_ID = "US";
const DAILY_REVENUE = 240_000;
/** Well below the legacy 0.5 haircut floor, so both capacity gates bite hard. */
const UTILIZATION = 0.2;
const TURNS = 12;

function makeCorp(): Corporation {
  return {
    _id: CORP_ID,
    name: "Deepbore Minerals",
    countryId: COUNTRY_ID,
    sectorType: "extraction",
    liquidCapital: 10_000_000,
    createdAt: new Date(),
  } as unknown as Corporation;
}

function makeSector(
  sectorType: "extraction" | "manufacturing",
  overrides: Partial<CorporateSector> = {}
): CorporateSector {
  return {
    _id: SECTOR_ID,
    corporationId: CORP_ID,
    stateId: STATE_ID,
    countryId: COUNTRY_ID,
    sectorType,
    strategyId: "standard",
    revenue: DAILY_REVENUE,
    profitMargin: 20,
    effectiveProfitMargin: 20,
    currentGrowthRate: 0,
    targetGrowthRate: 0,
    currentGrowthCost: 0,
    productionPolicy: 0,
    productionPolicyLevel: 0,
    workers: 1000,
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
    marketShareBySectorId: new Map([[SECTOR_ID.toString(), 0]]),
    allTariffs: [],
    activeFtaPairs: new Set(),
    ftaCoverage: { byCountryEconomyWide: new Map(), bySectorType: new Map() },
    activeSubsidies: [],
    priceRatioByCommodity: new Map(),
    globalCommodityBalances: new Map(),
    stateInputAvailabilityByState: new Map(),
    nationalCommodityBalancesByCountry: new Map(),
    rawStateBalances: new Map(),
    extractionCapacityUtilBySector: new Map([
      [SECTOR_ID.toString(), { utilization: UTILIZATION, bindingResource: "oil" }],
    ]),
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

function makeEnv(mode: "capital" | "plants", currentTurn: number): SectorTurnEnv {
  return {
    lookups: makeLookups(),
    turn: currentTurn,
    currentTurn,
    now: new Date("2026-08-01T00:00:00Z"),
    techTreesEnabled: false,
    labour: { wagesEnabled: false },
    market: buildMarketContext(mode),
    wageIndexByState: new Map(),
    automationIndexByState: new Map(),
    labourDemandByState: new Map(),
    pendingStrikeEvents: [],
    pendingCapacityBindingEvents: [],
    sectorOps: [],
  } as unknown as SectorTurnEnv;
}

/**
 * Replay one sector for `TURNS` consecutive turns, carrying each turn's
 * persisted `$set` forward as the next turn's stored document — the closest
 * thing to a live turn loop a unit test can get without a database.
 */
function replay(mode: "capital" | "plants", seed: CorporateSector, startTurn = 1000) {
  let sector = seed;
  const hourly: number[] = [];
  const storedRevenue: number[] = [];
  const storedStock: number[] = [];
  for (let i = 0; i < TURNS; i++) {
    const env = makeEnv(mode, startTurn + i);
    const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
    const op = env.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } };
    const set = op.updateOne.update.$set;
    hourly.push(result.hourlyRevenue);
    storedRevenue.push(set.revenue as number);
    storedStock.push(set.capitalStock as number);
    sector = { ...sector, ...set } as CorporateSector;
  }
  return { hourly, storedRevenue, storedStock };
}

const SUPPLY = getEffectiveStrategyRates("extraction", "standard", undefined, undefined, 0)
  .supply as Partial<Record<CommodityType, number>>;
const IMPLIED_UNITS = impliedOutputUnits(DAILY_REVENUE, SUPPLY, COMMODITY_BASE_PRICES, 1);
const STOCK = IMPLIED_UNITS * CAPITAL_SEED_HEADROOM;

/** Geometric decay at the 0.5 haircut floor would put turn 12 here. */
const GEOMETRIC_12 = 0.5 ** (TURNS - 1);

describe("plants — multi-turn revenue stability", () => {
  it("does not decay geometrically for an extraction sector at flat capacity", () => {
    // `capacityHaircutStartTurn` far in the past ⇒ the legacy revenue haircut is
    // fully ramped and pinned at its 0.5 floor, and `plantsStartTurn` in the
    // past ⇒ the plants hard min is fully ramped at 0.2. Both capacity gates are
    // as harsh as the model allows, and they are CONSTANT across the replay — so
    // any downward trend in the series is feedback, not economics.
    const { hourly, storedRevenue, storedStock } = replay(
      "plants",
      makeSector("extraction", {
        capitalStock: STOCK,
        capacityHaircutStartTurn: 1,
        plantsStartTurn: 1,
      } as Partial<CorporateSector>)
    );

    // Every turn earns real money — no drift toward zero.
    for (const r of hourly) expect(r).toBeGreaterThan(0);

    // The persisted nameplate tracks capacity only. Capacity depreciates at
    // ~0.05%/turn with no growth and no build orders, so over 12 turns the
    // stored revenue may fall a fraction of a percent and no more. A realization
    // leg leaking into the nameplate would show up here first.
    const revDrift = storedRevenue[TURNS - 1] / storedRevenue[0];
    expect(revDrift).toBeGreaterThan(0.99);
    expect(revDrift).toBeLessThanOrEqual(1);
    // Same shape on the stock the nameplate is priced from.
    expect(storedStock[TURNS - 1] / storedStock[0]).toBeGreaterThan(0.99);

    // Realized revenue is likewise stable, and nowhere near the geometric decay
    // a compounding haircut would produce (0.5^11 ≈ 0.05% of turn one).
    const realizedDrift = hourly[TURNS - 1] / hourly[0];
    expect(realizedDrift).toBeGreaterThan(0.99);
    expect(realizedDrift).toBeGreaterThan(GEOMETRIC_12 * 100);
    // Turn-over-turn the series is monotone-ish and flat: no single step loses
    // more than the depreciation rate can explain.
    for (let i = 1; i < TURNS; i++) expect(hourly[i] / hourly[i - 1]).toBeGreaterThan(0.995);
  });

  it("is equally stable for a non-extraction sector (no capacity gate at all)", () => {
    const { hourly, storedRevenue } = replay(
      "plants",
      makeSector("manufacturing", {
        capitalStock: STOCK,
        plantsStartTurn: 1,
      } as Partial<CorporateSector>)
    );
    for (const r of hourly) expect(r).toBeGreaterThan(0);
    expect(storedRevenue[TURNS - 1] / storedRevenue[0]).toBeGreaterThan(0.99);
    expect(hourly[TURNS - 1] / hourly[0]).toBeGreaterThan(0.99);
  });

  it("leaves the below-plants (capital mode) trajectory unchanged", () => {
    // The control arm: capital mode compounds its nameplate off `sector.revenue`
    // by design, and the legacy haircut lives on the revenue side there. This
    // asserts the P3b/rounding edits did not touch that path — the series is
    // flat at zero growth, exactly as it was before.
    const { hourly, storedRevenue } = replay(
      "capital",
      makeSector("extraction", {
        capitalStock: STOCK,
        capacityHaircutStartTurn: 1,
      } as Partial<CorporateSector>)
    );
    for (const r of hourly) expect(r).toBeGreaterThan(0);
    expect(storedRevenue[TURNS - 1] / storedRevenue[0]).toBeCloseTo(1, 6);
    expect(hourly[TURNS - 1] / hourly[0]).toBeCloseTo(1, 6);
  });

  it("keeps revenue === capitalStock × mixPrice on the STORED pair (rounding identity)", () => {
    // FIX 2: the persisted `capitalStock` is rounded to 2dp, so the nameplate
    // must be priced from that SAME rounded figure or the stored pair silently
    // violates the identity the SOE overlay and the shed/attack conservation
    // arguments assume. mixPrice is 1/Σ(rate/base), recoverable from the seed.
    const mixPrice = DAILY_REVENUE / IMPLIED_UNITS;
    const { storedRevenue, storedStock } = replay(
      "plants",
      makeSector("extraction", {
        capitalStock: STOCK,
        plantsStartTurn: 1,
      } as Partial<CorporateSector>)
    );
    for (let i = 0; i < TURNS; i++) {
      expect(storedRevenue[i]).toBeCloseTo(storedStock[i] * mixPrice, 6);
    }
  });
});
