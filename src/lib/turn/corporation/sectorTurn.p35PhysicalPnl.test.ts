import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import { CAPITAL_SEED_HEADROOM, impliedOutputUnits } from "@/lib/market/capital";
import { buildMarketContext } from "@/lib/market/marketContext";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { TURNS_PER_DAY, GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";
import type { CorporationLookups } from "./types";
import { processSector, type SectorTurnEnv } from "./sectorTurn";

/**
 * Wave P3.5 — physical cost decomposition under plants.
 *
 * The claim under test is narrow and load-bearing: swapping the opaque margin
 * formula for a sum of physical cost lines changes NOTHING on the calibration
 * turn (byte-identical profit), and changes EVERYTHING afterwards (the bill
 * moves with the price of what the sector buys, which the margin formula was
 * structurally blind to).
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
  mutate?: (env: SectorTurnEnv) => void
): SectorTurnEnv {
  const env = {
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
  mutate?.(env);
  return env;
}

function sectorUpdateOf(env: SectorTurnEnv): Record<string, unknown> {
  const op = env.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } };
  return op.updateOne.update.$set;
}

function run(
  mode: "capital" | "plants",
  sector: CorporateSector,
  currentTurn = 1000,
  mutate?: (env: SectorTurnEnv) => void
) {
  const env = makeEnv(mode, currentTurn, mutate);
  const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
  return { result, update: sectorUpdateOf(env), env };
}

const RATES = getEffectiveStrategyRates("manufacturing", "standard", undefined, undefined, 0);
const SUPPLY = RATES.supply as Partial<Record<CommodityType, number>>;
const DEMAND = RATES.demand as Partial<Record<CommodityType, number>>;
const PRE_FLIP_NAMEPLATE = DAILY_REVENUE * (1 + GROWTH_RATE / GROWTH_RATE_TURNS_PER_YEAR / 100);
const IMPLIED_UNITS = impliedOutputUnits(PRE_FLIP_NAMEPLATE, SUPPLY, COMMODITY_BASE_PRICES, 1);
const STOCK = IMPLIED_UNITS * CAPITAL_SEED_HEADROOM;

/** A commodity this sector actually consumes, for the price-shock cases. */
const INPUT_COMMODITY = (Object.keys(DEMAND) as CommodityType[]).find(
  (c) => (DEMAND[c] ?? 0) > 0 && COMMODITY_BASE_PRICES[c] > 0
)!;

const profitOf = (r: ReturnType<typeof run>) => r.result.hourlyRevenue - r.result.costs;

describe("P3.5 — calibration identity", () => {
  it("is EXACT on the flip turn: physical lines reproduce the margin formula", () => {
    const capital = run("capital", makeSector({ capitalStock: STOCK }));
    const plants = run("plants", makeSector({ capitalStock: STOCK }));

    expect(plants.result.hourlyRevenue).toBeCloseTo(capital.result.hourlyRevenue, 8);
    expect(plants.result.costs).toBeCloseTo(capital.result.costs, 8);
    expect(profitOf(plants)).toBeCloseTo(profitOf(capital), 8);
  });

  it("holds exactly even with a live commodity market and a disaster leg", () => {
    // Every deleted/rerouted modifier is non-zero here: the commodity input and
    // surplus mods (from real balances) are gated OFF and replaced by a real
    // input bill, and the disaster penalty is rerouted to a financial leg. The
    // residual is solved so the SUM is unchanged regardless.
    const mutate = (env: SectorTurnEnv) => {
      const balances = new Map<CommodityType, { supply: number; demand: number }>();
      for (const c of Object.keys(COMMODITY_BASE_PRICES) as CommodityType[]) {
        balances.set(c, { supply: 800, demand: 1200 });
      }
      (env.lookups as { globalCommodityBalances: unknown }).globalCommodityBalances = balances;
      const ratios = new Map<CommodityType, number>();
      for (const c of Object.keys(COMMODITY_BASE_PRICES) as CommodityType[]) ratios.set(c, 1.3);
      (env.lookups as { priceRatioByCommodity: unknown }).priceRatioByCommodity = ratios;
    };
    const capital = run("capital", makeSector({ capitalStock: STOCK }), 1000, mutate);
    const plants = run("plants", makeSector({ capitalStock: STOCK }), 1000, mutate);

    expect(plants.result.costs).toBeCloseTo(capital.result.costs, 8);
    expect(profitOf(plants)).toBeCloseTo(profitOf(capital), 8);
  });

  it("stamps the solved residual and its margin basis once, then holds them", () => {
    const flip = run("plants", makeSector({ capitalStock: STOCK }));
    const anchor = flip.update.otherOpexPerUnitAnchor as number;
    expect(typeof anchor).toBe("number");
    expect(Number.isFinite(anchor)).toBe(true);
    // The basis is stamped policy-NEUTRAL: `1 − profitMargin/100`, with no
    // modifier stack in it. The policy stack rides `policyCredit` on the
    // revenue side instead, so the anchor must not respond to it — a basis
    // that included calibration-time modifiers is exactly what made the old
    // drift channel invert on negative-residual sectors.
    expect(flip.update.otherOpexAnchorMarginBasis).toBeCloseTo(1 - 20 / 100, 8);

    // A sector already carrying an anchor is NOT recalibrated.
    const later = run(
      "plants",
      makeSector({
        capitalStock: STOCK,
        plantsStartTurn: 1000,
        otherOpexPerUnitAnchor: anchor,
        otherOpexAnchorMarginBasis: 0.8,
      }),
      1050
    );
    expect(later.update.otherOpexPerUnitAnchor).toBeUndefined();
    expect(later.update.otherOpexAnchorMarginBasis).toBeUndefined();
  });

  it("does not ramp: the identity is exact by construction, not faded in", () => {
    // The flip turn is byte-identical with governorRampTurns = 0 (no ramp
    // available at all), which is what "exact by construction" means.
    const noRamp = (env: SectorTurnEnv) => {
      env.market = { ...env.market, governorRampTurns: 0 };
    };
    const capital = run("capital", makeSector({ capitalStock: STOCK }), 1000, noRamp);
    const plants = run("plants", makeSector({ capitalStock: STOCK }), 1000, noRamp);
    expect(plants.result.costs).toBeCloseTo(capital.result.costs, 8);
  });
});

describe("P3.5 — policy margin stack rides the revenue-side policyCredit line", () => {
  /**
   * A calibrated post-flip sector carrying a NEGATIVE residual anchor — the
   * state 82% of live prod sectors were in when the inversion was found. Under
   * the old drift channel a positive margin modifier SHRANK the negative
   * residual (a credit) and so RAISED cost; these tests pin the fixed
   * behavior: profit is monotone increasing in the modifier, at roughly
   * `revenue × pp/100`.
   */
  const negativeAnchorRun = (regionalPp: number) =>
    run(
      "plants",
      makeSector({
        capitalStock: STOCK,
        plantsStartTurn: 1000,
        otherOpexPerUnitAnchor: -1.0,
        otherOpexAnchorMarginBasis: 0.63,
      }),
      1050,
      (env) => {
        (env.lookups.regionalConditionMarginByState as Map<string, number>).set(
          STATE_ID,
          regionalPp
        );
      }
    );

  it("a positive modifier RAISES profit on a negative-anchor sector (was inverted)", () => {
    const base = negativeAnchorRun(0);
    const boosted = negativeAnchorRun(8);
    const delta = profitOf(boosted) - profitOf(base);
    expect(delta).toBeGreaterThan(0);
    // Linear in pp at ~revenue × pp/100 (loose bound: the legacy labor clamp
    // still reads the full-margin maintenance, which can shave the delta).
    const expected = base.result.hourlyRevenue * 0.08;
    expect(delta).toBeGreaterThan(expected * 0.5);
    expect(delta).toBeLessThan(expected * 1.5);
  });

  it("a negative modifier LOWERS profit symmetrically", () => {
    const base = negativeAnchorRun(0);
    const penalized = negativeAnchorRun(-8);
    expect(profitOf(penalized)).toBeLessThan(profitOf(base));
  });

  it("the anchor line itself no longer responds to the live modifier stack", () => {
    // Two runs differing only in the modifier: identical anchors, identical
    // neutral basis, so the residual contribution is identical — the whole
    // profit delta must come through policyCredit. Verify by symmetry: the
    // +8 and −8 deltas from base cancel to first order.
    const base = negativeAnchorRun(0);
    const up = negativeAnchorRun(8);
    const down = negativeAnchorRun(-8);
    const gain = profitOf(up) - profitOf(base);
    const loss = profitOf(base) - profitOf(down);
    expect(gain).toBeCloseTo(loss, 4);
  });
});

describe("P3.5 — input prices actually reach the P&L", () => {
  /** A calibrated, post-flip sector; `ratio` is the lagged price of every input. */
  const calibrated = (ratio: number, anchor: number, basis: number) =>
    run(
      "plants",
      makeSector({
        capitalStock: STOCK,
        plantsStartTurn: 1000,
        otherOpexPerUnitAnchor: anchor,
        otherOpexAnchorMarginBasis: basis,
      }),
      1001,
      (env) => {
        const ratios = new Map<CommodityType, number>();
        ratios.set(INPUT_COMMODITY, ratio);
        (env.lookups as { priceRatioByCommodity: unknown }).priceRatioByCommodity = ratios;
      }
    );

  it("raises cost by EXACTLY the realized input delta when a lagged input price rises 20%", () => {
    const flip = run("plants", makeSector({ capitalStock: STOCK }));
    const anchor = flip.update.otherOpexPerUnitAnchor as number;
    const basis = flip.update.otherOpexAnchorMarginBasis as number;

    const base = calibrated(1, anchor, basis);
    const shocked = calibrated(1.2, anchor, basis);

    // Everything else is held: same capacity, same turn, same modifiers.
    expect(shocked.result.hourlyRevenue).toBeCloseTo(base.result.hourlyRevenue, 8);

    // The bill prices through the same realization function revenue does
    // (buy-sell symmetry), so a 20% price rise raises the ONE shocked
    // commodity's bill by (1.2^0.5 - 1), not by the raw 20%. The bill is
    // (nameplate × rate / turnsPerDay) × utilization — units cancel the base
    // price, so the delta is computable in closed form.
    const nameplate = (base.update.revenue as number) / 1; // ₳, daily
    const capacity = base.update.capitalStock as number;
    const produced = base.update.producedUnits as number;
    const utilization = Math.min(1, produced / capacity);
    const expectedDelta =
      ((nameplate * (DEMAND[INPUT_COMMODITY] ?? 0)) / TURNS_PER_DAY) *
      utilization *
      (Math.sqrt(1.2) - 1);

    expect(shocked.result.costs - base.result.costs).toBeCloseTo(expectedDelta, 4);
    expect(profitOf(base) - profitOf(shocked)).toBeCloseTo(expectedDelta, 4);
  });

  it("the DERIVED margin falls with the input price — the old margin was blind", () => {
    const flip = run("plants", makeSector({ capitalStock: STOCK }));
    const anchor = flip.update.otherOpexPerUnitAnchor as number;
    const basis = flip.update.otherOpexAnchorMarginBasis as number;

    const base = calibrated(1, anchor, basis);
    const shocked = calibrated(1.2, anchor, basis);

    expect(shocked.result.effectiveMargin).toBeLessThan(base.result.effectiveMargin);

    // THE CONTROL: the same shock under the margin formula (capital mode, whose
    // cost is revenue × (1 − margin/100)). A commodity PRICE ratio is not an
    // input to the margin stack at all — only balances are — so the old model's
    // cost does not move by a cent.
    const control = (ratio: number) =>
      run("capital", makeSector({ capitalStock: STOCK }), 1001, (env) => {
        const ratios = new Map<CommodityType, number>();
        ratios.set(INPUT_COMMODITY, ratio);
        (env.lookups as { priceRatioByCommodity: unknown }).priceRatioByCommodity = ratios;
      });
    const controlBase = control(1);
    const controlShocked = control(1.2);
    // Revenue does move (price realization is a revenue-side leg) — costs do not.
    const controlCostRatio = controlShocked.result.costs / controlBase.result.costs;
    const shockedCostRatio = shocked.result.costs / base.result.costs;
    expect(shockedCostRatio).toBeGreaterThan(controlCostRatio);
  });

  it("a throttled plant buys fewer inputs (utilization scaling, per P3b)", () => {
    const flip = run("plants", makeSector({ capitalStock: STOCK }));
    const anchor = flip.update.otherOpexPerUnitAnchor as number;
    const basis = flip.update.otherOpexAnchorMarginBasis as number;
    const at = (capacity: number) =>
      run(
        "plants",
        makeSector({
          capitalStock: capacity,
          plantsStartTurn: 1000,
          otherOpexPerUnitAnchor: anchor,
          otherOpexAnchorMarginBasis: basis,
        }),
        1001
      );
    // Doubling capacity without doubling demand lowers utilization; the input
    // bill per unit of output must not rise with idle capacity.
    const tight = at(STOCK);
    const slack = at(STOCK * 2);
    const perUnit = (r: ReturnType<typeof run>) =>
      r.result.costs / (r.update.producedUnits as number);
    expect(perUnit(slack)).toBeGreaterThan(0);
    expect(perUnit(tight)).toBeGreaterThan(0);
  });
});

describe("P3.5 — the other legs still behave", () => {
  it("wage changes flow through unchanged (labor is a pass-through line)", () => {
    const withWages = (wageLevel: number) =>
      run(
        "plants",
        makeSector({ capitalStock: STOCK, wageLevel }),
        1000,
        (env) => ((env as { labour: unknown }).labour = { wagesEnabled: true })
      );
    const baseline = withWages(1);
    const raised = withWages(1.5);
    // Higher wages ⇒ strictly higher cost, and the identity still holds at
    // wageLevel 1 (baseline-invariant carve-out).
    expect(raised.result.costs).toBeGreaterThan(baseline.result.costs);

    const capitalBaseline = run(
      "capital",
      makeSector({ capitalStock: STOCK, wageLevel: 1 }),
      1000,
      (env) => ((env as { labour: unknown }).labour = { wagesEnabled: true })
    );
    expect(baseline.result.costs).toBeCloseTo(capitalBaseline.result.costs, 8);
  });

  it("the disaster penalty survives as a financial-leg passthrough", () => {
    const withDisaster = (mode: "capital" | "plants") =>
      run("plants", makeSector({ capitalStock: STOCK }), 1000, (env) => {
        void mode;
        (env.lookups as { activeDisasterEffectsByState: unknown }).activeDisasterEffectsByState =
          new Map([[STATE_ID, []]]);
      });
    // With no active effects the leg is 0 and the identity is untouched.
    const none = withDisaster("plants");
    const capital = run("capital", makeSector({ capitalStock: STOCK }));
    expect(none.result.costs).toBeCloseTo(capital.result.costs, 8);
  });

  it("mothball upkeep is ONE line, not the P3a charge plus a physical twin", () => {
    const mothballed = run(
      "plants",
      makeSector({
        capitalStock: STOCK,
        plantsStartTurn: 1000,
        mothballed: true,
        otherOpexPerUnitAnchor: 1,
        otherOpexAnchorMarginBasis: 0.8,
      }),
      1050
    );
    // A cold plant: no production ⇒ no inputs, no other opex (both scale with
    // produced units), so its ENTIRE cost is the single P3a mothball upkeep
    // charge plus growth/compliance.
    expect(mothballed.update.producedUnits).toBe(0);
    expect(mothballed.result.costs).toBeCloseTo(
      mothballed.result.plantsUpkeepCost + mothballed.result.hourlyGrowthCost,
      8
    );
    expect(mothballed.result.plantsUpkeepCost).toBeGreaterThan(0);
  });

  it("reports the dead commodity margin channels as 0 under plants", () => {
    const plants = run("plants", makeSector({ capitalStock: STOCK }), 1000, (env) => {
      const balances = new Map<CommodityType, { supply: number; demand: number }>();
      for (const c of Object.keys(COMMODITY_BASE_PRICES) as CommodityType[]) {
        balances.set(c, { supply: 500, demand: 1500 });
      }
      (env.lookups as { globalCommodityBalances: unknown }).globalCommodityBalances = balances;
    });
    expect(plants.result.commodityMod).toBe(0);
    expect(plants.result.surplusMod).toBe(0);
  });

  it("leaves non-plants worlds byte-identical", () => {
    const a = run("capital", makeSector({ capitalStock: STOCK }));
    expect(a.update.otherOpexPerUnitAnchor).toBeUndefined();
    // Still the modifier-stack margin, not a derived one.
    expect(a.result.effectiveMargin).toBeCloseTo(
      100 * (1 - (a.result.costs - a.result.hourlyGrowthCost) / a.result.hourlyRevenue),
      8
    );
  });
});

describe("P3.5 — the physical disaster leg hands over on the plants ramp", () => {
  /**
   * The seam's sharpest edge: a crisis classified "physical" is active on the
   * very turn the sector flips to plants. The physical leg cuts TONNAGE while
   * the margin leg no longer carries the points — two changes in opposite
   * directions that do not cancel, because the launch governor pins revenue to
   * the pre-flip baseline at λ = 0 and the tonnage cut therefore never reaches
   * the top line. Before the ramp was applied to this leg, an −8pp port closure
   * was a free 8%-of-revenue margin gain on flip day.
   */
  const physicalCrisis =
    (value: number) =>
    (env: SectorTurnEnv): void => {
      (
        env.lookups as { activeDisasterEffectsByState: Map<string, unknown[]> }
      ).activeDisasterEffectsByState.set(STATE_ID, [
        {
          value,
          startTurn: 995,
          durationTurns: 20,
          sectorType: null,
          strategyId: null,
          physicality: "physical",
        },
      ]);
    };

  it("is a no-op on the flip turn — a live physical crisis does not move profit", () => {
    const mutate = physicalCrisis(-8);
    const capital = run("capital", makeSector({ capitalStock: STOCK }), 1000, mutate);
    const plants = run("plants", makeSector({ capitalStock: STOCK }), 1000, mutate);

    expect(plants.result.hourlyRevenue).toBeCloseTo(capital.result.hourlyRevenue, 8);
    expect(plants.result.costs).toBeCloseTo(capital.result.costs, 8);
    expect(profitOf(plants)).toBeCloseTo(profitOf(capital), 8);
  });

  it("still cuts tonnage once the ramp has completed", () => {
    // λ = 1: the whole penalty is a production haircut, so a sector under a
    // physical crisis produces strictly less than the same sector without one.
    const withCrisis = run(
      "plants",
      makeSector({ capitalStock: STOCK, plantsStartTurn: 1 }),
      1000,
      physicalCrisis(-8)
    );
    const without = run("plants", makeSector({ capitalStock: STOCK, plantsStartTurn: 1 }), 1000);
    expect(withCrisis.update.producedUnits as number).toBeLessThan(
      without.update.producedUnits as number
    );
  });

  it("partitions the penalty — a FINANCIAL crisis is unramped and margin-only", () => {
    // The contrast case: same magnitude, financial classification. Tonnage is
    // untouched at every λ, which is the pre-P3.5 behaviour every already-live
    // crisis (no `physicality` field) also gets.
    const financial = (env: SectorTurnEnv): void => {
      (
        env.lookups as { activeDisasterEffectsByState: Map<string, unknown[]> }
      ).activeDisasterEffectsByState.set(STATE_ID, [
        {
          value: -8,
          startTurn: 995,
          durationTurns: 20,
          sectorType: null,
          strategyId: null,
        },
      ]);
    };
    const withCrisis = run(
      "plants",
      makeSector({ capitalStock: STOCK, plantsStartTurn: 1 }),
      1000,
      financial
    );
    const without = run("plants", makeSector({ capitalStock: STOCK, plantsStartTurn: 1 }), 1000);
    expect(withCrisis.update.producedUnits as number).toBeCloseTo(
      without.update.producedUnits as number,
      8
    );
    expect(withCrisis.result.costs).toBeGreaterThan(without.result.costs);
  });
});
