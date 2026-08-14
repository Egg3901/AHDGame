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

/**
 * Composed nasty-state FLIP IDENTITY regression suite.
 *
 * The plants flip is only safe if it is a no-op on the flip turn for EVERY
 * sector, not just a clean one: strikes, mid-strategy transitions, depleted
 * deposits, active physical crises, deep negative margins, legacy documents
 * missing the capital fields, zero-revenue sectors, embargo mothballs and a
 * mid-ramp clearing governor all have to reproduce the capital-mode numbers to
 * 1e-6. Each case here is a real defect class found by hostile review; they
 * stay pinned so the governor and identity work cannot regress silently.
 */

const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();
const STATE_ID = "US-CA";
const COUNTRY_ID = "US";
const DAILY_REVENUE = 240_000;
const GROWTH_RATE = 4;

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

function makeLookups(opts: {
  marketSharePct?: number;
  extractionUtil?: number;
  disasterEffects?: unknown[];
}): CorporationLookups {
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
    marketShareBySectorId: new Map([[SECTOR_ID.toString(), opts.marketSharePct ?? 0]]),
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
            [SECTOR_ID.toString(), { utilization: opts.extractionUtil, bindingResource: "iron" }],
          ])
        : new Map(),
    stateResourceCapacityByState: new Map(),
    stateSectorSpecializationByState: new Map(),
    rawWorkforceSkillByState: new Map(),
    regionalConditionMarginByState: new Map(),
    sectorPresenceKeys: new Set(),
    exportIntensityByCountry: new Map(),
    activeDisasterEffectsByState: new Map(
      opts.disasterEffects ? [[STATE_ID, opts.disasterEffects]] : []
    ),
    politicalBoardByState: new Map(),
  } as unknown as CorporationLookups;
}

function makeEnv(
  mode: "capital" | "plants",
  currentTurn: number,
  lookups: CorporationLookups,
  unions = false
): SectorTurnEnv {
  return {
    lookups,
    turn: currentTurn,
    currentTurn,
    now: new Date("2026-08-01T00:00:00Z"),
    techTreesEnabled: false,
    labour: { wagesEnabled: unions, unionsEnabled: unions },
    market: buildMarketContext(mode),
    wageIndexByState: new Map(),
    automationIndexByState: new Map(),
    pendingStrikeEvents: [],
    pendingCapacityBindingEvents: [],
    sectorOps: [],
  } as unknown as SectorTurnEnv;
}

function run(
  mode: "capital" | "plants",
  sector: CorporateSector,
  lookupOpts: Parameters<typeof makeLookups>[0] = {},
  currentTurn = 1000,
  unions = false
) {
  const env = makeEnv(mode, currentTurn, makeLookups(lookupOpts), unions);
  const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
  const op = env.sectorOps[0] as
    { updateOne: { update: { $set?: Record<string, unknown> } } } | undefined;
  // C4: the turn no longer `$set`s the whole `buildQueue`. Orders it appends
  // (the flip-turn growth credit) arrive as a `$push` in a second op.
  const pushed = env.sectorOps
    .map((o) => (o as { updateOne: { update: { $push?: { buildQueue?: unknown } } } }).updateOne)
    .map((u) => u.update.$push?.buildQueue)
    .filter((v) => v != null);
  return { result, update: op?.updateOne.update.$set ?? {}, pushedOrders: pushed, env };
}

const SUPPLY = getEffectiveStrategyRates("manufacturing", "standard", undefined, undefined, 0)
  .supply as Partial<Record<CommodityType, number>>;
const PRE_FLIP_NAMEPLATE = DAILY_REVENUE * (1 + GROWTH_RATE / GROWTH_RATE_TURNS_PER_YEAR / 100);
const STOCK =
  impliedOutputUnits(PRE_FLIP_NAMEPLATE, SUPPLY, COMMODITY_BASE_PRICES, 1) * CAPITAL_SEED_HEADROOM;

const profitOf = (r: ReturnType<typeof run>) => r.result.hourlyRevenue - r.result.costs;

function expectIdentity(cap: ReturnType<typeof run>, pl: ReturnType<typeof run>) {
  expect(pl.result.hourlyRevenue).toBeCloseTo(cap.result.hourlyRevenue, 6);
  expect(pl.result.costs).toBeCloseTo(cap.result.costs, 6);
  expect(profitOf(pl)).toBeCloseTo(profitOf(cap), 6);
}

describe("plants flip identity: composed nasty states", () => {
  it("strike active on flip turn", () => {
    const s = () => makeSector({ capitalStock: STOCK, strikeStartedAtTurn: 995 });
    expectIdentity(run("capital", s(), {}, 1000, true), run("plants", s(), {}, 1000, true));
  });

  it("mid-strategy-transition on flip turn", () => {
    const s = () =>
      makeSector({
        capitalStock: STOCK,
        strategyId: "premium",
        transitionFromStrategyId: "standard",
        transitionStartTurn: 995,
      });
    expectIdentity(run("capital", s()), run("plants", s()));
  });

  it("extraction sector on depleted deposit (util 0.07) on flip turn", () => {
    const supply = getEffectiveStrategyRates("extraction", "standard", undefined, undefined, 0)
      .supply as Partial<Record<CommodityType, number>>;
    const stock =
      impliedOutputUnits(PRE_FLIP_NAMEPLATE, supply, COMMODITY_BASE_PRICES, 1) *
      CAPITAL_SEED_HEADROOM;
    const s = () =>
      makeSector({
        sectorType: "extraction",
        capitalStock: stock,
        capacityHaircutStartTurn: 800,
      });
    const cap = run("capital", s(), { extractionUtil: 0.07 });
    const pl = run("plants", s(), { extractionUtil: 0.07 });
    expectIdentity(cap, pl);
  });

  it("physical crisis (port closure -8pp) active on flip turn", () => {
    const eff = {
      value: -8,
      startTurn: 995,
      durationTurns: 10,
      sectorType: null,
      strategyId: null,
      physicality: "physical",
    };
    const s = () => makeSector({ capitalStock: STOCK });
    expectIdentity(
      run("capital", s(), { disasterEffects: [eff] }),
      run("plants", s(), { disasterEffects: [eff] })
    );
  });

  it("deep negative margin on flip turn", () => {
    const s = () => makeSector({ capitalStock: STOCK, profitMargin: -35 });
    expectIdentity(run("capital", s()), run("plants", s()));
  });

  it("legacy doc: no capitalStock, no growth fields, on flip turn", () => {
    const s = () =>
      makeSector({
        capitalStock: undefined,
        currentGrowthRate: undefined as unknown as number,
        targetGrowthRate: undefined as unknown as number,
        currentGrowthCost: undefined as unknown as number,
      });
    const cap = run("capital", s());
    const pl = run("plants", s());
    expectIdentity(cap, pl);
    expect(Number.isFinite(pl.result.hourlyRevenue)).toBe(true);
  });

  it("zero-revenue sector on flip turn does not NaN", () => {
    const s = () => makeSector({ revenue: 0, capitalStock: 0 });
    const cap = run("capital", s());
    const pl = run("plants", s());
    expect(Number.isFinite(pl.result.hourlyRevenue)).toBe(true);
    expect(Number.isFinite(pl.result.costs)).toBe(true);
    expectIdentity(cap, pl);
  });

  it("growth spend with target slider at 0 is NOT confiscated (credit order)", () => {
    // C10 REGRESSION. Player paid growth cost while the slider decays to 0:
    // currentGrowthCost > 0, targetGrowthRate 0. The flip credit used to be
    // gated on targetGrowthRate > 0, which confiscated the spend of exactly the
    // players who had already stopped growing. It keys on the ACCRUED COST now:
    // if cost was charged, capacity is owed.
    const s = () =>
      makeSector({
        capitalStock: STOCK,
        currentGrowthCost: 60_000,
        currentGrowthRate: 2,
        targetGrowthRate: 0,
      });
    const pl = run("plants", s());
    expect(pl.pushedOrders.length).toBe(1);
  });

  it("legacy embargo mothball on flip turn", () => {
    const s = () => makeSector({ capitalStock: STOCK });
    const withEmbargo = (mode: "capital" | "plants") => {
      const lookups = makeLookups({});
      (
        lookups as unknown as { corporateEmbargoSuppression: Set<string> }
      ).corporateEmbargoSuppression = new Set([`${COUNTRY_ID}|${COUNTRY_ID}`]);
      const env = makeEnv(mode, 1000, lookups);
      const result = processSector(env, makeCorp(), s(), 1, undefined, 1);
      return { result };
    };
    const cap = withEmbargo("capital");
    const pl = withEmbargo("plants");
    expect(pl.result.hourlyRevenue).toBeCloseTo(cap.result.hourlyRevenue, 6);
    expect(pl.result.costs).toBeCloseTo(cap.result.costs, 6);
  });

  it("clearing governor mid-ramp (factor 0.8) on flip turn", () => {
    const s = () => makeSector({ capitalStock: STOCK, clearingStartTurn: 900 });
    const withClearing = (mode: "capital" | "plants") => {
      const env = makeEnv(mode, 1000, makeLookups({}));
      (env.market as unknown as Record<string, unknown>).clearingBySectorId = new Map([
        [
          SECTOR_ID.toString(),
          { factor: 0.8, soldFraction: 0.8, priceLeg: 1, effectivePosture: 0 },
        ],
      ]);
      const result = processSector(env, makeCorp(), s(), 1, undefined, 1);
      return { result };
    };
    const cap = withClearing("capital");
    const pl = withClearing("plants");
    expect(pl.result.hourlyRevenue).toBeCloseTo(cap.result.hourlyRevenue, 6);
    expect(pl.result.costs).toBeCloseTo(cap.result.costs, 6);
  });

  it("dominant + strike + transition + growth-ramp composed on flip turn", () => {
    const s = () =>
      makeSector({
        capitalStock: STOCK,
        currentGrowthCost: 60_000,
        strategyId: "premium",
        transitionFromStrategyId: "standard",
        transitionStartTurn: 995,
        strikeStartedAtTurn: 995,
      });
    expectIdentity(
      run("capital", s(), { marketSharePct: 70 }, 1000, true),
      run("plants", s(), { marketSharePct: 70 }, 1000, true)
    );
  });
});
