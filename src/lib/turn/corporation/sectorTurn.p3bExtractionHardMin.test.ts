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
 * P3b — extraction runs on ONE capacity system under plants.
 *
 * Below plants, geology reaches an extraction sector as a soft REVENUE haircut:
 * floored at 0.5 and faded in over a 240-turn per-sector grace window. Under
 * plants it becomes a HARD MIN on produced units — no floor, no per-sector
 * grace — fading in on the sector's own `plantsStartTurn` like every other
 * plants leg, so the flip turn is still a no-op.
 */

const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();
const STATE_ID = "US-TX";
const COUNTRY_ID = "US";
const DAILY_REVENUE = 240_000;
/** Well below the 0.5 haircut floor — the whole point of the hard min. */
const UTILIZATION = 0.2;

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

function makeSector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: SECTOR_ID,
    corporationId: CORP_ID,
    stateId: STATE_ID,
    countryId: COUNTRY_ID,
    sectorType: "extraction",
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
    nationalCommodityBalancesByCountry: new Map(),
    rawStateBalances: new Map(),
    extractionCapacityUtilBySector: new Map([
      [SECTOR_ID.toString(), { utilization: UTILIZATION, bindingResource: "oil" }],
    ]),
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
    pendingStrikeEvents: [],
    pendingCapacityBindingEvents: [],
    sectorOps: [],
  } as unknown as SectorTurnEnv;
}

function run(mode: "capital" | "plants", sector: CorporateSector, currentTurn = 1000) {
  const env = makeEnv(mode, currentTurn);
  const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
  const op = env.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } };
  return { result, env, update: op.updateOne.update.$set };
}

const SUPPLY = getEffectiveStrategyRates("extraction", "standard", undefined, undefined, 0)
  .supply as Partial<Record<CommodityType, number>>;
const IMPLIED_UNITS = impliedOutputUnits(DAILY_REVENUE, SUPPLY, COMMODITY_BASE_PRICES, 1);
const STOCK = IMPLIED_UNITS * CAPITAL_SEED_HEADROOM;

describe("P3b extraction hard-min (plants)", () => {
  it("leaves the flip turn unchanged even with a fully-ramped legacy haircut", () => {
    // `capacityHaircutStartTurn` far in the past ⇒ the legacy haircut is fully
    // ramped and pinned at its 0.5 floor under capital mode. On the sector's
    // FIRST plants turn the hard min must not move realized revenue at all.
    const sector = () =>
      makeSector({ capitalStock: STOCK, capacityHaircutStartTurn: 1 } as Partial<CorporateSector>);
    const capitalRun = run("capital", sector());
    const plantsRun = run("plants", sector());

    expect(plantsRun.result.hourlyRevenue).toBeCloseTo(capitalRun.result.hourlyRevenue, 8);
    expect(plantsRun.result.costs).toBeCloseTo(capitalRun.result.costs, 8);
  });

  it("cuts produced units to the deposit once the plants ramp has completed", () => {
    // Same sector, well past its own plants flip: geology is now a hard min at
    // 0.2, below the 0.5 floor the legacy haircut could never go under.
    const capitalRun = run(
      "capital",
      makeSector({ capitalStock: STOCK, capacityHaircutStartTurn: 1 } as Partial<CorporateSector>)
    );
    const plantsRun = run(
      "plants",
      makeSector({
        capitalStock: STOCK,
        capacityHaircutStartTurn: 1,
        plantsStartTurn: 1,
      } as Partial<CorporateSector>)
    );

    // Capital mode is floored at 0.5 of nameplate; plants is not.
    expect(plantsRun.update.producedUnits as number).toBeLessThan(
      capitalRun.update.producedUnits as number
    );
    // ≈ capacity × utilization (capacity is one turn of depreciation below STOCK).
    expect((plantsRun.update.producedUnits as number) / (STOCK * UTILIZATION)).toBeCloseTo(1, 2);
    expect(plantsRun.result.hourlyRevenue).toBeLessThan(capitalRun.result.hourlyRevenue);
  });
});
