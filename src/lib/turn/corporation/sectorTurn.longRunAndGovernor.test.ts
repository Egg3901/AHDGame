import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { CAPITAL_SEED_HEADROOM, impliedOutputUnits } from "@/lib/market/capital";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import { buildMarketContext } from "@/lib/market/marketContext";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import type { CorporationLookups } from "./types";
import { processSector, type SectorTurnEnv } from "./sectorTurn";
import type { DisasterEffectEntry } from "@/lib/crises/disasterMarginPenalty";

/**
 * p5 hostile-review throwaway: long-run (120+ turn) extension of
 * sectorTurn.plantsMultiTurn.test.ts, plus adversarial physical-crisis probes.
 * Not part of the branch's own suite — delete freely.
 */

const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();
const STATE_ID = "US-TX";
const COUNTRY_ID = "US";
const DAILY_REVENUE = 240_000;
const TURNS = 120;

function makeCorp(): Corporation {
  return {
    _id: CORP_ID,
    name: "Longrun Test Corp",
    countryId: COUNTRY_ID,
    sectorType: "manufacturing",
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

function makeLookups(
  opts: {
    extractionUtil?: number;
    disasterEntries?: DisasterEffectEntry[];
  } = {}
): CorporationLookups {
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
    extractionCapacityUtilBySector:
      opts.extractionUtil != null
        ? new Map([
            [SECTOR_ID.toString(), { utilization: opts.extractionUtil, bindingResource: "oil" }],
          ])
        : new Map(),
    stateResourceCapacityByState: new Map(),
    stateSectorSpecializationByState: new Map(),
    rawWorkforceSkillByState: new Map(),
    regionalConditionMarginByState: new Map(),
    sectorPresenceKeys: new Set(),
    exportIntensityByCountry: new Map(),
    activeDisasterEffectsByState: opts.disasterEntries
      ? new Map([[STATE_ID, opts.disasterEntries]])
      : new Map(),
    politicalBoardByState: new Map(),
  } as unknown as CorporationLookups;
}

function makeEnv(
  mode: "capital" | "plants",
  currentTurn: number,
  lookups: CorporationLookups
): SectorTurnEnv {
  return {
    lookups,
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

function replay(
  mode: "capital" | "plants",
  seed: CorporateSector,
  turns: number,
  lookupsFor: (turn: number) => CorporationLookups,
  startTurn = 1000
) {
  let sector = seed;
  const hourly: number[] = [];
  const storedRevenue: number[] = [];
  const storedStock: number[] = [];
  const profitProxy: number[] = [];
  for (let i = 0; i < turns; i++) {
    const env = makeEnv(mode, startTurn + i, lookupsFor(startTurn + i));
    const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
    const op = env.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } };
    const set = op.updateOne.update.$set;
    hourly.push(result.hourlyRevenue);
    profitProxy.push(result.hourlyRevenue - result.costs);
    storedRevenue.push(set.revenue as number);
    storedStock.push(set.capitalStock as number);
    sector = { ...sector, ...set } as CorporateSector;
  }
  return { hourly, storedRevenue, storedStock, profitProxy };
}

const SUPPLY = getEffectiveStrategyRates("manufacturing", "standard", undefined, undefined, 0)
  .supply as Partial<Record<CommodityType, number>>;
const IMPLIED_UNITS = impliedOutputUnits(DAILY_REVENUE, SUPPLY, COMMODITY_BASE_PRICES, 1);
const STOCK = IMPLIED_UNITS * CAPITAL_SEED_HEADROOM;

const EX_SUPPLY = getEffectiveStrategyRates("extraction", "standard", undefined, undefined, 0)
  .supply as Partial<Record<CommodityType, number>>;
const EX_UNITS = impliedOutputUnits(DAILY_REVENUE, EX_SUPPLY, COMMODITY_BASE_PRICES, 1);

describe("plants long-run stability (120 turns)", () => {
  it("manufacturing at flat capacity neither explodes nor collapses over 120 turns", () => {
    const { hourly, storedRevenue } = replay(
      "plants",
      makeSector("manufacturing", { capitalStock: STOCK, plantsStartTurn: 1 }),
      TURNS,
      () => makeLookups()
    );
    const revDrift = storedRevenue[TURNS - 1] / storedRevenue[0];
    const realDrift = hourly[TURNS - 1] / hourly[0];
    // ~0.05%/turn depreciation over 119 turns ≈ 0.942
    expect(revDrift).toBeGreaterThan(0.9);
    expect(revDrift).toBeLessThan(1.001);
    expect(realDrift).toBeGreaterThan(0.9);
    expect(realDrift).toBeLessThan(1.001);
  });

  it("extraction at util 0.2 stays bounded (no geometric decay) over 120 turns", () => {
    const { hourly } = replay(
      "plants",
      makeSector("extraction", {
        capitalStock: EX_UNITS * CAPITAL_SEED_HEADROOM,
        plantsStartTurn: 1,
        capacityHaircutStartTurn: 1,
      }),
      TURNS,
      () => makeLookups({ extractionUtil: 0.2 })
    );
    for (const r of hourly) expect(r).toBeGreaterThan(0);
    expect(hourly[TURNS - 1] / hourly[0]).toBeGreaterThan(0.9);
  });

  it("flip-turn migration then 150 turns with a live growth target stays sane", () => {
    const { hourly, storedRevenue, storedStock } = replay(
      "plants",
      makeSector("manufacturing", {
        // No plantsStartTurn, no capitalStock: this IS the flip turn.
        targetGrowthRate: 4,
        currentGrowthRate: 4,
        currentGrowthCost: 5000,
      }),
      150,
      () => makeLookups()
    );
    for (const r of hourly) {
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThan(0);
    }
    // No explosion: bounded well under 2x, no collapse below half.
    expect(storedRevenue[149] / storedRevenue[0]).toBeLessThan(2);
    expect(storedRevenue[149] / storedRevenue[0]).toBeGreaterThan(0.5);
    expect(Number.isFinite(storedStock[149])).toBe(true);
  });
});

/**
 * C5/C8 REGRESSION. The governor used to route a revenue AMOUNT through the
 * FACTOR helper, whose `<= 0` fallback substitutes the baseline. A fully halted
 * plant therefore earned its ENTIRE baseline revenue with none of the costs
 * (~6x profit pump), and the fixed +/-15% cap meant even a partial halt could
 * never cut revenue by more than 15% no matter how long the world had run.
 * These cases pin both halves of the fix.
 */
describe("physical crisis vs the revenue governor", () => {
  const halt: DisasterEffectEntry[] = [
    {
      value: -100,
      startTurn: 1000,
      durationTurns: 100000,
      sectorType: null,
      strategyId: null,
      physicality: "physical",
    },
  ];
  const half: DisasterEffectEntry[] = [{ ...halt[0], value: -50 }];

  function oneTurn(entries: DisasterEffectEntry[] | undefined) {
    // Fully ramped plants sector (plantsStartTurn far in the past).
    const env = makeEnv("plants", 1000, makeLookups({ disasterEntries: entries }));
    const sector = makeSector("manufacturing", { capitalStock: STOCK, plantsStartTurn: 1 });
    const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
    const set = (env.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } })
      .updateOne.update.$set;
    return { result, producedUnits: set.producedUnits as number };
  }

  it("a TOTAL physical halt (-100pp, fully ramped) should not earn full revenue", () => {
    const base = oneTurn(undefined);
    const halted = oneTurn(halt);
    expect(halted.producedUnits).toBe(0);
    // Fully ramped: the cap is released, so zero production earns EXACTLY zero.
    expect(halted.result.hourlyRevenue).toBe(0);
    expect(base.result.hourlyRevenue).toBeGreaterThan(0);
  });

  it("a TOTAL halt should not be MORE profitable than normal operation", () => {
    const base = oneTurn(undefined);
    const halted = oneTurn(halt);
    const baseProfit = base.result.hourlyRevenue - base.result.costs;
    const haltProfit = halted.result.hourlyRevenue - halted.result.costs;
    expect(haltProfit).toBeLessThan(baseProfit);
  });

  it("post-calibration, a TOTAL halt must not be a PROFIT PUMP", () => {
    // Turn 1: normal turn calibrates otherOpexPerUnitAnchor. Turn 2+: total halt.
    let sector = makeSector("manufacturing", { capitalStock: STOCK, plantsStartTurn: 1 });
    const envCal = makeEnv("plants", 1000, makeLookups());
    const baseRes = processSector(envCal, makeCorp(), sector, 1, undefined, 1);
    const baseProfit = baseRes.hourlyRevenue - baseRes.costs;
    const set = (
      envCal.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } }
    ).updateOne.update.$set;
    sector = { ...sector, ...set } as CorporateSector;
    const envHalt = makeEnv("plants", 1001, makeLookups({ disasterEntries: halt }));
    const haltRes = processSector(envHalt, makeCorp(), sector, 1, undefined, 1);
    const haltProfit = haltRes.hourlyRevenue - haltRes.costs;
    expect(haltProfit).toBeLessThan(baseProfit);
  });

  it("a -50pp physical halt (fully ramped) should cut revenue ~50%, not 15%", () => {
    const base = oneTurn(undefined);
    const halved = oneTurn(half);
    expect(halved.result.hourlyRevenue).toBeLessThan(base.result.hourlyRevenue * 0.7);
  });
});
