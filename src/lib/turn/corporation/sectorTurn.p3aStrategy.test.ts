import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CommodityType } from "@/lib/constants/commodities";
import { buildMarketContext } from "@/lib/market/marketContext";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import {
  rescaleCapacityForStrategyChange,
  techOutputUnitsMultiplier,
} from "@/lib/constants/capacityEconomy";
import { getSectorTechEffects } from "@/lib/constants/techTree";
import type { CorporationLookups } from "./types";
import { processSector, type SectorTurnEnv } from "./sectorTurn";

/**
 * P3a strategy/pricing third — the three behaviours that touch the turn engine:
 *
 *  D9   capacity is one currency, so utilization must not move across a retool;
 *  tech `outputRateMult` must reach the PLANTS units chain, not just the ledger;
 *  dominance is tolled ONCE under plants, at build time.
 *
 * Energy is the fixture sector because it is the one tree carrying a real
 * `outputRate` node (`energy-1950-2`, +7% energy output, sector lane).
 */

const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();
const STATE_ID = "US-CA";
const COUNTRY_ID = "US";
const DAILY_REVENUE = 240_000;
const OUTPUT_RATE_NODE = "energy-1950-2";

function makeCorp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: CORP_ID,
    name: "Plantsco",
    countryId: COUNTRY_ID,
    type: "energy",
    sectorType: "energy",
    liquidCapital: 10_000_000,
    createdAt: new Date(),
    ...overrides,
  } as unknown as Corporation;
}

function makeSector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: SECTOR_ID,
    corporationId: CORP_ID,
    stateId: STATE_ID,
    countryId: COUNTRY_ID,
    sectorType: "energy",
    strategyId: "standard",
    revenue: DAILY_REVENUE,
    profitMargin: 20,
    effectiveProfitMargin: 20,
    currentGrowthRate: 4,
    targetGrowthRate: 4,
    currentGrowthCost: 0,
    productionPolicy: 0,
    productionPolicyLevel: 0,
    workers: 1000,
    createdAt: new Date(),
    ...overrides,
  } as unknown as CorporateSector;
}

function makeLookups(marketSharePct = 0): CorporationLookups {
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

interface EnvOpts {
  techTreesEnabled?: boolean;
  marketSharePct?: number;
}

function makeEnv(
  mode: "capital" | "plants",
  currentTurn: number,
  opts: EnvOpts = {}
): SectorTurnEnv {
  return {
    lookups: makeLookups(opts.marketSharePct ?? 0),
    turn: currentTurn,
    currentTurn,
    now: new Date("2026-08-01T00:00:00Z"),
    techTreesEnabled: opts.techTreesEnabled === true,
    labour: { wagesEnabled: false },
    market: buildMarketContext(mode),
    wageIndexByState: new Map(),
    automationIndexByState: new Map(),
    pendingStrikeEvents: [],
    pendingCapacityBindingEvents: [],
    sectorOps: [],
  } as unknown as SectorTurnEnv;
}

function sectorUpdateOf(env: SectorTurnEnv): Record<string, unknown> {
  const op = env.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } };
  return op.updateOne.update.$set;
}

function run(
  mode: "capital" | "plants",
  sector: CorporateSector,
  corp: Corporation = makeCorp(),
  opts: EnvOpts = {},
  currentTurn = 1000
) {
  const env = makeEnv(mode, currentTurn, opts);
  const result = processSector(env, corp, sector, 1, undefined, 1);
  return { result, update: sectorUpdateOf(env), env };
}

// ─── D9: capital-mode utilization is invariant across a retool ───────────────

describe("D9 — retool leaves capital-mode utilization alone", () => {
  /**
   * Under capital mode, `capitalUtilization` = capitalStock / impliedOutputUnits.
   * A retool changes the implied-units denominator by the ratio of the two
   * mixes' unit yields. Rescaling the stock by the SAME ratio is exactly what
   * keeps the sector running as hard after the retool as before it — the plant
   * did not get bigger or smaller because the CEO changed their mind about what
   * to make.
   */
  const FROM = "standard";
  const TO = "renewables";
  // Deliberately below implied units so `capitalUtilization` is a live ratio
  // rather than pinned at its 1.0 ceiling — a clamped reading would prove nothing.
  const STOCK = 1_000;

  it("keeps utilization identical when the stock is rescaled", () => {
    const before = run(
      "capital",
      makeSector({ strategyId: FROM, capitalStock: STOCK } as Partial<CorporateSector>)
    );
    const rescaled = rescaleCapacityForStrategyChange(STOCK, "energy", FROM, TO);
    const after = run(
      "capital",
      makeSector({ strategyId: TO, capitalStock: rescaled } as Partial<CorporateSector>)
    );
    expect(after.update.capitalUtilization).toBeCloseTo(
      before.update.capitalUtilization as number,
      3
    );
  });

  it("and WOULD move materially without the rescale — the bug this closes", () => {
    const before = run(
      "capital",
      makeSector({ strategyId: FROM, capitalStock: STOCK } as Partial<CorporateSector>)
    );
    const unrescaled = run(
      "capital",
      makeSector({ strategyId: TO, capitalStock: STOCK } as Partial<CorporateSector>)
    );
    expect(unrescaled.update.capitalUtilization).not.toBeCloseTo(
      before.update.capitalUtilization as number,
      3
    );
  });

  it("keeps the plants nameplate invariant across the retool", () => {
    const before = run(
      "plants",
      makeSector({
        strategyId: FROM,
        capitalStock: STOCK,
        plantsStartTurn: 900,
      } as Partial<CorporateSector>)
    );
    const rescaled = rescaleCapacityForStrategyChange(STOCK, "energy", FROM, TO);
    const after = run(
      "plants",
      makeSector({
        strategyId: TO,
        capitalStock: rescaled,
        plantsStartTurn: 900,
      } as Partial<CorporateSector>)
    );
    // `revenue` under plants IS capacity x mixPrice — the nameplate.
    expect(after.update.revenue as number).toBeCloseTo(before.update.revenue as number, 2);
  });
});

// ─── Tech outputRateMult reaches the plants units chain ─────────────────────

describe("tech outputRate — plants units chain", () => {
  const SUPPLY = getEffectiveStrategyRates("energy", "standard", undefined, undefined, 0)
    .supply as Partial<Record<CommodityType, number>>;

  function techCorp(): Corporation {
    return makeCorp({ unlockedTechNodeIds: [OUTPUT_RATE_NODE] } as Partial<Corporation>);
  }

  const EXPECTED_MULT = () =>
    techOutputUnitsMultiplier(
      SUPPLY,
      getSectorTechEffects({ type: "energy", unlockedTechNodeIds: [OUTPUT_RATE_NODE] }, "energy")
        .outputRateMult
    );

  it("the fixture node really does raise output (guards against a silent no-op test)", () => {
    expect(EXPECTED_MULT()).toBeGreaterThan(1);
  });

  it("raises producedUnits by exactly the unit-weighted output multiplier", () => {
    const sector = () =>
      makeSector({ capitalStock: 3_000, plantsStartTurn: 900 } as Partial<CorporateSector>);
    const plain = run("plants", sector(), makeCorp(), { techTreesEnabled: true });
    const withTech = run("plants", sector(), techCorp(), { techTreesEnabled: true });
    expect(withTech.update.producedUnits as number).toBeCloseTo(
      (plain.update.producedUnits as number) * EXPECTED_MULT(),
      // `producedUnits` is persisted rounded to 2dp; 1dp is the honest tolerance.
      1
    );
  });

  it("does NOT change producedUnits outside plants — non-plants stays byte-identical", () => {
    const sector = () => makeSector({ capitalStock: 3_000 } as Partial<CorporateSector>);
    const plain = run("capital", sector(), makeCorp(), { techTreesEnabled: true });
    const withTech = run("capital", sector(), techCorp(), { techTreesEnabled: true });
    expect(withTech.update.producedUnits).toBe(plain.update.producedUnits);
  });

  it("is neutral for a corp with no unlocked nodes — the flip identity fixture", () => {
    // The flip-identity guarantee rests on outputRateMult defaulting to 1. Pin
    // it with the tech tree ON but nothing researched, which is the state every
    // corp in a tech-enabled world starts in.
    const sector = () => makeSector({ capitalStock: 3_000 } as Partial<CorporateSector>);
    const treeOff = run("plants", sector(), makeCorp(), { techTreesEnabled: false });
    const treeOnNothingResearched = run("plants", sector(), makeCorp(), {
      techTreesEnabled: true,
    });
    expect(treeOnNothingResearched.update.producedUnits).toBe(treeOff.update.producedUnits);
    expect(treeOnNothingResearched.result.hourlyRevenue).toBeCloseTo(
      treeOff.result.hourlyRevenue,
      8
    );
  });
});

// ─── Dominance toll consolidation ───────────────────────────────────────────

describe("dominance toll consolidation", () => {
  // plantsStartTurn is set MORE than `MARKET_REALIZATION_RAMP_TURNS` (240)
  // before the run turn (1000), so the consolidation is fully faded in. The
  // toll is not switched off at the flip — it fades out over the same ramp
  // every other plants leg uses, or a dominant sector's costs would step down
  // on flip day and break the tier's flip identity
  // (`sectorTurn.p3aFlipIdentity.test.ts` pins that end).
  const dominant = () =>
    makeSector({ capitalStock: 3_000, plantsStartTurn: 700 } as Partial<CorporateSector>);

  it("outside plants a dominant sector still pays the margin penalty and revenue tax", () => {
    const small = run("capital", dominant(), makeCorp(), { marketSharePct: 10 });
    const big = run("capital", dominant(), makeCorp(), { marketSharePct: 95 });
    expect(big.result.effectiveMargin).toBeLessThan(small.result.effectiveMargin);
    // Revenue tax: same revenue, strictly higher costs.
    expect(big.result.hourlyRevenue).toBeCloseTo(small.result.hourlyRevenue, 6);
    expect(big.result.costs).toBeGreaterThan(small.result.costs);
  });

  it("under plants a dominant sector's margin is undistorted", () => {
    const small = run("plants", dominant(), makeCorp(), { marketSharePct: 10 });
    const big = run("plants", dominant(), makeCorp(), { marketSharePct: 95 });
    expect(big.result.effectiveMargin).toBeCloseTo(small.result.effectiveMargin, 9);
    expect(big.update.effectiveProfitMargin).toBe(small.update.effectiveProfitMargin);
  });

  it("under plants a dominant sector pays no dominance revenue tax", () => {
    const small = run("plants", dominant(), makeCorp(), { marketSharePct: 10 });
    const big = run("plants", dominant(), makeCorp(), { marketSharePct: 95 });
    // The ONLY remaining share-sensitive per-turn line is the vestigial growth
    // cost; isolate the revenue tax by netting it out.
    expect(big.result.costs - big.result.hourlyGrowthCost).toBeCloseTo(
      small.result.costs - small.result.hourlyGrowthCost,
      6
    );
  });

  it("dominance is therefore paid only at build time under plants", () => {
    // Full statement of the design: at 95% share the sector's whole per-turn
    // P&L is identical to a 10%-share sector's, net of the vestigial growth
    // line. The toll lives entirely in `computeBuildCost`.
    const small = run("plants", dominant(), makeCorp(), { marketSharePct: 10 });
    const big = run("plants", dominant(), makeCorp(), { marketSharePct: 95 });
    const netProfit = (r: { hourlyRevenue: number; costs: number; hourlyGrowthCost: number }) =>
      r.hourlyRevenue - (r.costs - r.hourlyGrowthCost);
    expect(netProfit(big.result)).toBeCloseTo(netProfit(small.result), 6);
  });
});
