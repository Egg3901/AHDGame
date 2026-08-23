import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { CAPITAL_SEED_HEADROOM, impliedOutputUnits } from "@/lib/market/capital";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import { buildMarketContext } from "@/lib/market/marketContext";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";
import type { CorporationLookups } from "./types";
import { processSector, type SectorTurnEnv } from "./sectorTurn";
import { applySectorTurnOps } from "./applySectorTurnOps";

/**
 * P3a INTEGRATED FLIP IDENTITY.
 *
 * `sectorTurn.plants.test.ts` pins the flip identity for a PLAIN sector. P3a
 * then added three independent flip-turn behaviours, written by three separate
 * agents that never composed their work:
 *
 *   1. idle/mothball upkeep — an additive cost, ramped on `plantsStartTurn`
 *      so λ = 0 on the flip turn;
 *   2. growth-ramp conversion — turns in-flight growth spend into a free
 *      build-credit order, and zeroes the legacy growth fields;
 *   3. dominance toll consolidation — gates the margin penalty and the
 *      revenue tax off under plants;
 *   4. tech output multiplier — claimed exactly 1 with no tech.
 *
 * Each is individually defensible. The promise of the tier is that the flip
 * turn itself changes NOTHING, so the only test that matters is the composed
 * one: same sector, same turn, capital vs plants, on a sector that trips all
 * four legs at once. That is this file.
 */

const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();
const STATE_ID = "US-CA";
const COUNTRY_ID = "US";
const DAILY_REVENUE = 240_000;
const GROWTH_RATE = 4;
/** Well above the dominance threshold, so both dominance tolls are live. */
const DOMINANT_SHARE = 70;

function makeCorp(): Corporation {
  return {
    _id: CORP_ID,
    name: "Plantsco",
    countryId: COUNTRY_ID,
    sectorType: "manufacturing",
    liquidCapital: 10_000_000,
    createdAt: new Date(),
  } as unknown as Corporation;
}

function makeSector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: SECTOR_ID,
    corporationId: CORP_ID,
    stateId: STATE_ID,
    countryId: COUNTRY_ID,
    sectorType: "manufacturing",
    strategyId: "standard",
    revenue: DAILY_REVENUE,
    profitMargin: 20,
    effectiveProfitMargin: 20,
    currentGrowthRate: GROWTH_RATE,
    targetGrowthRate: GROWTH_RATE,
    currentGrowthCost: 0,
    productionPolicy: 0,
    productionPolicyLevel: 0,
    workers: 1000,
    createdAt: new Date(),
    ...overrides,
  } as unknown as CorporateSector;
}

function makeLookups(marketSharePct: number): CorporationLookups {
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
    marketShareBySectorId: new Map([[SECTOR_ID.toString(), marketSharePct]]),
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
    regionalConditionMarginByState: new Map(),
    sectorPresenceKeys: new Set(),
    exportIntensityByCountry: new Map(),
    activeDisasterEffectsByState: new Map(),
    politicalBoardByState: new Map(),
  } as unknown as CorporationLookups;
}

function makeEnv(
  mode: "capital" | "plants",
  currentTurn: number,
  marketSharePct: number
): SectorTurnEnv {
  return {
    lookups: makeLookups(marketSharePct),
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

function sectorUpdateOf(env: SectorTurnEnv): Record<string, unknown> {
  const op = env.sectorOps[0] as { updateOne: { update: { $set?: Record<string, unknown> } } };
  return op.updateOne.update.$set ?? {};
}

function run(
  mode: "capital" | "plants",
  sector: CorporateSector,
  marketSharePct: number,
  currentTurn = 1000
) {
  const env = makeEnv(mode, currentTurn, marketSharePct);
  const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
  return {
    result,
    update: sectorUpdateOf(env),
    doc: applySectorTurnOps(sector as unknown as Record<string, unknown>, env.sectorOps),
    env,
  };
}

const SUPPLY = getEffectiveStrategyRates("manufacturing", "standard", undefined, undefined, 0)
  .supply as Partial<Record<CommodityType, number>>;
const PRE_FLIP_NAMEPLATE = DAILY_REVENUE * (1 + GROWTH_RATE / GROWTH_RATE_TURNS_PER_YEAR / 100);
const IMPLIED_UNITS = impliedOutputUnits(PRE_FLIP_NAMEPLATE, SUPPLY, COMMODITY_BASE_PRICES, 1);
const STOCK = IMPLIED_UNITS * CAPITAL_SEED_HEADROOM;

const profitOf = (r: ReturnType<typeof run>) => r.result.hourlyRevenue - r.result.costs;

describe("P3a integrated flip identity", () => {
  it("is exact on the flip turn for a NON-dominant sector mid growth-ramp", () => {
    // Trips the idle-upkeep ramp (capacity carries the 1.1x headroom, so there
    // ARE idle units) and the growth-ramp conversion (currentGrowthCost > 0),
    // but not the dominance legs.
    const sector = () => makeSector({ capitalStock: STOCK, currentGrowthCost: 60_000 });
    const capitalRun = run("capital", sector(), 0);
    const plantsRun = run("plants", sector(), 0);

    expect(plantsRun.result.hourlyRevenue).toBeCloseTo(capitalRun.result.hourlyRevenue, 8);
    expect(plantsRun.result.costs).toBeCloseTo(capitalRun.result.costs, 8);
    expect(profitOf(plantsRun)).toBeCloseTo(profitOf(capitalRun), 8);
    // The idle-upkeep ramp must be an exact no-op on the flip turn.
    expect(plantsRun.result.plantsUpkeepCost).toBe(0);
    // The growth conversion lands as a FREE order — no CIP, so no phantom asset.
    expect(plantsRun.result.constructionInProgressAnchor).toBe(0);
    expect((plantsRun.doc.buildQueue as unknown[]).length).toBe(1);
  });

  it("is exact on the flip turn for a DOMINANT sector", () => {
    // Same sector, market share above the dominance threshold. Under capital it
    // pays a margin penalty AND a revenue tax; P3a gates both off under plants.
    // If that gating is not ramped, flip day is a visible profit jump — which
    // is exactly what the tier promises never happens.
    const sector = () => makeSector({ capitalStock: STOCK, currentGrowthCost: 60_000 });
    const capitalRun = run("capital", sector(), DOMINANT_SHARE);
    const plantsRun = run("plants", sector(), DOMINANT_SHARE);

    expect(plantsRun.result.hourlyRevenue).toBeCloseTo(capitalRun.result.hourlyRevenue, 8);
    expect(plantsRun.result.costs).toBeCloseTo(capitalRun.result.costs, 8);
    expect(profitOf(plantsRun)).toBeCloseTo(profitOf(capitalRun), 8);
  });

  it("still consolidates the dominance toll once the ramp has completed", () => {
    // The identity above must not be bought by disabling the consolidation:
    // well after the flip, a dominant plants sector DOES run at an undistorted
    // margin (dominance is tolled at build time instead).
    const sector = () =>
      makeSector({ capitalStock: STOCK, plantsStartTurn: 100, currentGrowthCost: 0 });
    const capitalRun = run("capital", makeSector({ capitalStock: STOCK }), DOMINANT_SHARE, 1000);
    const plantsRun = run("plants", sector(), DOMINANT_SHARE, 1000);
    expect(profitOf(plantsRun)).toBeGreaterThan(profitOf(capitalRun));
  });
});
