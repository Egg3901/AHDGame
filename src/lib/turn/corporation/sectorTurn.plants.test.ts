import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import {
  COMMODITY_BASE_PRICES,
  plantsSupplyScaledUnits,
  type CommodityType,
} from "@/lib/constants/commodities";
import { getOutputMultiplier } from "@/lib/utils/productionPolicy";
import {
  CAPITAL_DEPRECIATION_PER_TURN,
  CAPITAL_SEED_HEADROOM,
  impliedOutputUnits,
} from "@/lib/market/capital";
import { buildMarketContext } from "@/lib/market/marketContext";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { TURNS_PER_DAY, GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";
import type { CorporationLookups } from "./types";
import { processSector, type SectorTurnEnv } from "./sectorTurn";
import { DEMAND_PROBE_MARGIN, DEMAND_THROTTLE_FLOOR } from "./demandThrottle";

/**
 * Plants tier (P2, buildable sectors): capacity is authoritative and revenue is
 * derived from produced units. These tests pin the two things that make the
 * tier safe to flip — the flip-turn identity against capital mode, and the
 * derived-revenue formula — plus the depreciation-only capacity advance and the
 * launch-safety governor.
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

/** Empty-but-complete lookups: every consumer sees "no data ⇒ neutral". */
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

/** The `$set` payload processSector queued for the sector. */
function sectorUpdateOf(env: SectorTurnEnv): Record<string, unknown> {
  const op = env.sectorOps[0] as { updateOne: { update: { $set?: Record<string, unknown> } } };
  return op.updateOne.update.$set ?? {};
}

function run(mode: "capital" | "plants", sector: CorporateSector, currentTurn = 1000) {
  const env = makeEnv(mode, currentTurn);
  const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
  return { result, update: sectorUpdateOf(env), env };
}

const SUPPLY = getEffectiveStrategyRates("manufacturing", "standard", undefined, undefined, 0)
  .supply as Partial<Record<CommodityType, number>>;
/** Nameplate revenue the pre-plants chain uses this turn (one turn of growth). */
const PRE_FLIP_NAMEPLATE = DAILY_REVENUE * (1 + GROWTH_RATE / GROWTH_RATE_TURNS_PER_YEAR / 100);
const IMPLIED_UNITS = impliedOutputUnits(PRE_FLIP_NAMEPLATE, SUPPLY, COMMODITY_BASE_PRICES, 1);
/** Revenue per output unit of the mix = 1 / Σ(rate/basePrice). */
const MIX_PRICE = PRE_FLIP_NAMEPLATE / IMPLIED_UNITS;

describe("plants mode — flip identity", () => {
  it("reproduces the capital-mode result exactly on the flip turn", () => {
    // A sector that has been running under capital: it carries a capitalStock
    // seeded with the 10% headroom, and no plantsStartTurn yet.
    const stock = IMPLIED_UNITS * CAPITAL_SEED_HEADROOM;
    const capitalRun = run("capital", makeSector({ capitalStock: stock }));
    const plantsRun = run("plants", makeSector({ capitalStock: stock }));

    expect(plantsRun.result.hourlyRevenue).toBeCloseTo(capitalRun.result.hourlyRevenue, 8);
    expect(plantsRun.update.realizedRevenue as number).toBeCloseTo(
      capitalRun.update.realizedRevenue as number,
      8
    );
    // The stored nameplate is restated from owned capacity, NOT from realized
    // earnings — `revenue` stays a potential figure (it is re-read as next
    // turn's anchor and drives the commodity supply ledger).
    expect(plantsRun.update.revenue as number).toBeCloseTo(
      (plantsRun.update.capitalStock as number) * MIX_PRICE,
      // capitalStock is persisted rounded to 2dp; the nameplate is not.
      -1
    );
    // Profit follows revenue: costs are untouched by the tier.
    const profit = (r: ReturnType<typeof run>) => r.result.hourlyRevenue - r.result.costs;
    expect(profit(plantsRun)).toBeCloseTo(profit(capitalRun), 8);
  });

  it("is exact for a sector arriving with no capacity at all", () => {
    const capitalRun = run("capital", makeSector());
    const plantsRun = run("plants", makeSector());
    expect(plantsRun.result.hourlyRevenue).toBeCloseTo(capitalRun.result.hourlyRevenue, 8);
  });

  it("stamps the governor ramp anchor once, on the flip turn", () => {
    const flip = run("plants", makeSector(), 1000);
    expect(flip.update.plantsStartTurn).toBe(1000);
    const later = run("plants", makeSector({ plantsStartTurn: 1000 }), 1200);
    expect(later.update.plantsStartTurn).toBe(1000);
  });
});

describe("plants mode — capacity", () => {
  it("migrates capacity to max(capitalStock, implied units) on the flip turn", () => {
    // Starved sector: stored capacity BELOW what its revenue implies, so the
    // migration takes the nameplate arm — which now carries CAPITAL_SEED_HEADROOM
    // so a post-flip sector starts with the same 1.1x slack capital-mode seeding
    // gives, instead of pinned at 100% utilization and decaying from turn one.
    const starved = run("plants", makeSector({ capitalStock: IMPLIED_UNITS * 0.5 }));
    expect(starved.update.capitalStock as number).toBeCloseTo(
      Math.round(
        IMPLIED_UNITS * CAPITAL_SEED_HEADROOM * (1 - CAPITAL_DEPRECIATION_PER_TURN) * 100
      ) / 100,
      2
    );
    // Over-capitalized sector keeps every unit it built.
    const rich = run("plants", makeSector({ capitalStock: IMPLIED_UNITS * 3 }));
    expect(rich.update.capitalStock as number).toBeCloseTo(
      Math.round(IMPLIED_UNITS * 3 * (1 - CAPITAL_DEPRECIATION_PER_TURN) * 100) / 100,
      2
    );
  });

  it("advances by depreciation only after the flip — growth no longer builds it", () => {
    const stock = 5_000;
    const post = run(
      "plants",
      makeSector({ capitalStock: stock, plantsStartTurn: 900, currentGrowthRate: 20 }),
      1000
    );
    expect(post.update.capitalStock as number).toBeCloseTo(
      stock * (1 - CAPITAL_DEPRECIATION_PER_TURN),
      2
    );
    // Same sector under capital would have GROWN (growth 20 ⇒ +0.417%/turn).
    const cap = run("capital", makeSector({ capitalStock: stock, currentGrowthRate: 20 }), 1000);
    expect(cap.update.capitalStock as number).toBeGreaterThan(stock);
  });
});

describe("plants mode — derived revenue", () => {
  // Ramp exhausted (λ = 1) and a wide cap, so the governor passes the derived
  // value through untouched and the raw formula is observable.
  const freeEnv = (sector: CorporateSector, currentTurn = 5000) => {
    const env = makeEnv("plants", currentTurn);
    // Cap far wider than any divergence under test ⇒ only the ramp matters.
    env.market = { ...env.market, governorCap: 1_000, governorRampTurns: 1 };
    const result = processSector(env, makeCorp(), sector, 1, undefined, 1);
    return { result, update: sectorUpdateOf(env) };
  };

  it("derives revenue as producedUnits × mixPrice (clearing/embargo legs = 1)", () => {
    const stock = 4_000;
    const { result, update } = freeEnv(
      makeSector({ capitalStock: stock, plantsStartTurn: 100 }),
      5000
    );
    const producedUnits = update.producedUnits as number;
    // Capacity depreciated once, then run through the production legs. With no
    // extraction haircut, no throughput scarcity, no strike and a neutral
    // production policy, produced == depreciated capacity.
    expect(producedUnits).toBeCloseTo(stock * (1 - CAPITAL_DEPRECIATION_PER_TURN), 2);
    // The P1 identity, inverted: units × mixPrice × sales legs == realized.
    expect(result.hourlyRevenue * TURNS_PER_DAY).toBeCloseTo(producedUnits * MIX_PRICE, 4);
    expect(update.realizedRevenue as number).toBeCloseTo(producedUnits * MIX_PRICE, 4);
  });

  it("scales linearly with capacity — twice the plants, twice the revenue", () => {
    const one = freeEnv(makeSector({ capitalStock: 4_000, plantsStartTurn: 100 }));
    const two = freeEnv(makeSector({ capitalStock: 8_000, plantsStartTurn: 100 }));
    expect(two.result.hourlyRevenue).toBeCloseTo(one.result.hourlyRevenue * 2, 6);
  });

  it("reports capacity utilization instead of a capacity haircut", () => {
    const { update } = freeEnv(makeSector({ capitalStock: 4_000, plantsStartTurn: 100 }));
    // produced ÷ capacity — 1 when every production leg is neutral.
    expect(update.capitalUtilization as number).toBeCloseTo(1, 3);
  });
});

describe("plants mode — nameplate stability", () => {
  /**
   * Regression: `sector.revenue` is re-read as next turn's anchor AND is what
   * computeRawSupplyDemand derives world commodity supply from. Persisting the
   * REALIZED figure there compounds every realization leg once per turn, so a
   * sector running at a steady sub-1 price realization decays geometrically
   * even though its capacity and produced units are flat. Pin that the stored
   * nameplate tracks capacity only.
   */
  it("does not compound realization legs into the stored nameplate", () => {
    // Every commodity trading at 0.8 of base ⇒ a steady sub-1 price realization.
    const priceRatios = new Map<CommodityType, number>(
      (Object.keys(SUPPLY) as CommodityType[]).map((c) => [c, 0.8])
    );
    let sector = makeSector();
    let lastRealized = 0;
    let postFlipNameplate = 0;
    for (let t = 1000; t < 1040; t++) {
      const env = makeEnv("plants", t);
      env.lookups.priceRatioByCommodity = priceRatios;
      processSector(env, makeCorp(), sector, 1, undefined, 1);
      const set = sectorUpdateOf(env);
      lastRealized = set.realizedRevenue as number;
      sector = { ...sector, ...set } as CorporateSector;
      if (t === 1000) postFlipNameplate = set.revenue as number;
    }
    // The invariant under test is NO COMPOUNDING, so measure against the
    // post-flip level rather than the pre-flip one: the flip itself applies a
    // deliberate ONE-TIME step (the migration seeds capacity with
    // CAPITAL_SEED_HEADROOM, and under plants the nameplate is restated from
    // capacity). After that step, only depreciation may move it — ~0.05%/turn
    // over the remaining 39 turns ⇒ ≈2%.
    expect(sector.revenue as number).toBeGreaterThan(postFlipNameplate * 0.95);
    expect(sector.revenue as number).toBeLessThan(postFlipNameplate * 1.01);
    // And realized revenue holds its realization gap instead of spiralling.
    expect(lastRealized).toBeGreaterThan(DAILY_REVENUE * 0.8);
  });

  /**
   * The flip-day step itself, pinned so it cannot drift unnoticed.
   *
   * SIDE EFFECT of seeding post-flip capacity with CAPITAL_SEED_HEADROOM: under
   * plants (unlike capital, where capacity is only a haircut) `sector.revenue`
   * is RESTATED from capacity, so a sector arriving with no stored capitalStock
   * takes a one-time ~+10% nameplate step on flip day. That nameplate is also
   * the base computeRawSupplyDemand derives world commodity supply from, so the
   * flip nudges world supply up ~10% for those sectors, once.
   *
   * PROVISIONAL: this is the price of making post-flip sectors consistent with
   * pre-flip ones under the current seeding rule. The alternative — no headroom —
   * bought a flat nameplate at the cost of every post-flip sector being born
   * pinned at 100% utilization and decaying immediately. Which trade is right is
   * the flip-day product decision; revisit when P3 build orders land.
   */
  it("takes a bounded one-time nameplate step on the flip turn", () => {
    const flip = run("plants", makeSector());
    const ratio = (flip.update.revenue as number) / PRE_FLIP_NAMEPLATE;
    expect(ratio).toBeCloseTo(CAPITAL_SEED_HEADROOM * (1 - CAPITAL_DEPRECIATION_PER_TURN), 2);
  });
});

describe("plants mode — launch-safety governor", () => {
  /**
   * C8: the cap is a TRANSITION device, not a permanent ceiling. Mid-ramp it
   * still binds (below); at full ramp it is released, so ten times the capacity
   * really does earn ten times the revenue. Leaving it clamped meant the whole
   * physical layer could never move revenue more than 15% no matter how much a
   * player built — the plants tier was cosmetic beyond that band.
   */
  it("clamps derived revenue mid-ramp", () => {
    // 10x capacity would be a 10x revenue jump. At λ = 0.5 the effective cap is
    // 0.15 / (1 − 0.5) = 0.30, so the blended step is 1 + 0.5 × 0.30 = 1.15.
    const env = makeEnv("plants", 5000);
    env.market = { ...env.market, governorRampTurns: 9800 }; // λ = (5000 − 100) / 9800 = 0.5
    const sector = makeSector({ capitalStock: IMPLIED_UNITS * 10, plantsStartTurn: 100 });
    const plants = processSector(env, makeCorp(), sector, 1, undefined, 1);
    const baseline = run("capital", makeSector({ capitalStock: IMPLIED_UNITS * 10 }), 5000);
    expect(plants.hourlyRevenue).toBeCloseTo(baseline.result.hourlyRevenue * 1.15, 6);
  });

  it("releases the clamp once fully ramped, so built capacity actually pays", () => {
    const env = makeEnv("plants", 5000);
    env.market = { ...env.market, governorRampTurns: 1 }; // λ = 1
    const sector = makeSector({ capitalStock: IMPLIED_UNITS * 10, plantsStartTurn: 100 });
    const plants = processSector(env, makeCorp(), sector, 1, undefined, 1);
    const baseline = run("capital", makeSector({ capitalStock: IMPLIED_UNITS * 10 }), 5000);
    expect(plants.hourlyRevenue).toBeGreaterThan(baseline.result.hourlyRevenue * 5);
  });

  it("needs no downside clamp below full capacity — the two tiers coincide", () => {
    // Below implied units, capital mode's haircut (stock/implied) and plants'
    // capacity-driven derivation produce the SAME revenue by construction:
    //   nameplate × (stock/implied) == stock × mixPrice.
    // So the governor's floor can only ever be reached via the sales legs, not
    // via capacity. Pinned because it is the reason there is no downside test
    // for capacity alone.
    const env = makeEnv("plants", 5000);
    env.market = { ...env.market, governorRampTurns: 1 };
    const starved = makeSector({ capitalStock: IMPLIED_UNITS * 0.4, plantsStartTurn: 100 });
    const plants = processSector(env, makeCorp(), starved, 1, undefined, 1);
    const baseline = run("capital", makeSector({ capitalStock: IMPLIED_UNITS * 0.4 }), 5000);
    // Within the one residual difference: capital mode's stock still grows with
    // the slider this turn (+g/48 %), plants' capacity only depreciates.
    // (0.08% at a 4% growth rate — an order of magnitude inside the ±15% cap.)
    expect(plants.hourlyRevenue / baseline.result.hourlyRevenue).toBeCloseTo(1, 2);
  });

  it("ramps the divergence in from zero — the flip turn itself is a no-op", () => {
    const rich = makeSector({ capitalStock: IMPLIED_UNITS * 10 });
    const flip = run("plants", rich, 1000);
    const baseline = run("capital", makeSector({ capitalStock: IMPLIED_UNITS * 10 }), 1000);
    expect(flip.result.hourlyRevenue).toBeCloseTo(baseline.result.hourlyRevenue, 8);
  });
});

// Capital-mode seeding (seedCapitalStock) gives a sector CAPITAL_SEED_HEADROOM
// (1.1x) its implied units, so it starts with slack instead of pinned at 100%
// utilization. The plants lazy-migration arm omitted that factor, so a sector
// created AFTER the flip was born at exactly 100% utilization and started
// depreciating on turn one — while an otherwise identical sector created before
// the flip carried slack. A sector's economics must not depend on which side of
// the flip day it happened to be created on.
describe("plants mode — flip-day migration headroom", () => {
  it("seeds a never-flipped sector with the same 1.1x headroom capital mode uses", () => {
    const plantsRun = run("plants", makeSector());
    expect(plantsRun.update.capitalStock as number).toBeCloseTo(
      IMPLIED_UNITS * CAPITAL_SEED_HEADROOM * (1 - CAPITAL_DEPRECIATION_PER_TURN),
      // capitalStock is persisted rounded to 2dp.
      2
    );
  });

  it("leaves the new sector with slack rather than pinned at full utilization", () => {
    const capacity = run("plants", makeSector()).update.capitalStock as number;
    // Capacity exceeds the units the revenue base implies, so the sector is not
    // immediately supply-bound.
    expect(capacity).toBeGreaterThan(IMPLIED_UNITS);
  });

  // The other arm of the max(): a REAL stored capitalStock already contains its
  // own headroom history (seeded at 1.1x, depreciated/invested since). Scaling
  // it again would silently gift capacity on every flip.
  it("does not re-apply headroom to an existing stored capitalStock", () => {
    const stock = IMPLIED_UNITS * CAPITAL_SEED_HEADROOM;
    const plantsRun = run("plants", makeSector({ capitalStock: stock }));
    expect(plantsRun.update.capitalStock as number).toBeCloseTo(
      stock * (1 - CAPITAL_DEPRECIATION_PER_TURN),
      2
    );
  });
});

describe("plants mode — D13 capital-mode restore point", () => {
  /**
   * `legacyRevenueShadow` is the counterfactual: what `revenue` would be if the
   * flip had never happened. It is only a restore point if it is INDEPENDENT of
   * `sector.revenue`, which plants restates from plant output every turn.
   *
   * The original implementation seeded it from `sectorRevenueAnchor × (1 + g)`
   * every turn, and `sectorRevenueAnchor` is read straight off `sector.revenue`
   * — so after the flip turn it tracked plants revenue, and with plants zeroing
   * `targetGrowthRate` it converged onto it exactly. Rolling back would have
   * restored the plants number under a different name.
   */
  const stepPlantsTurn = (sector: CorporateSector, turn: number) => {
    const { update } = run("plants", sector, turn);
    return makeSector({
      ...sector,
      revenue: update.revenue as number,
      capitalStock: update.capitalStock as number,
      plantsStartTurn: update.plantsStartTurn as number,
      currentGrowthRate: update.currentGrowthRate as number,
      targetGrowthRate: update.targetGrowthRate as number,
      legacyRevenueShadow: update.legacyRevenueShadow as number,
      legacyGrowthRateShadow: update.legacyGrowthRateShadow as number,
      legacyTargetGrowthRateShadow: update.legacyTargetGrowthRateShadow as number,
    });
  };

  it("seeds from the pre-flip nameplate on the flip turn", () => {
    const flip = run("plants", makeSector(), 1000);
    expect(flip.update.legacyRevenueShadow as number).toBeCloseTo(PRE_FLIP_NAMEPLATE, 6);
    // The pre-plants growth chain is captured before plants zeroes it.
    expect(flip.update.legacyGrowthRateShadow).toBe(GROWTH_RATE);
    expect(flip.update.legacyTargetGrowthRateShadow).toBe(GROWTH_RATE);
    expect(flip.update.targetGrowthRate).toBe(0);
  });

  it("diverges from plants revenue over several turns", () => {
    let sector = makeSector();
    const shadows: number[] = [];
    const revenues: number[] = [];
    for (let i = 0; i < 6; i++) {
      sector = stepPlantsTurn(sector, 1000 + i);
      shadows.push(sector.legacyRevenueShadow as number);
      revenues.push(sector.revenue);
    }
    // The shadow compounds at the LEGACY rate, monotonically, every turn.
    for (let i = 1; i < shadows.length; i++) {
      expect(shadows[i]).toBeGreaterThan(shadows[i - 1]);
      expect(shadows[i] / shadows[i - 1]).toBeCloseTo(
        1 + GROWTH_RATE / GROWTH_RATE_TURNS_PER_YEAR / 100,
        9
      );
    }
    // Plants revenue does not follow it (capacity depreciates, growth is off),
    // so the restore point is a genuinely separate series.
    // (plants revenue sits ABOVE the shadow here because the flip migration
    // seeds capacity with CAPITAL_SEED_HEADROOM; the direction is not the
    // point, the separation is.)
    expect(shadows[shadows.length - 1]).not.toBeCloseTo(revenues[revenues.length - 1], 0);
    for (let i = 1; i < revenues.length; i++) {
      expect(revenues[i] / revenues[i - 1]).not.toBeCloseTo(shadows[i] / shadows[i - 1], 6);
    }
  });

  it("compounds off its own previous value, not off restated revenue", () => {
    // A sector whose plants revenue has been knocked far below the shadow: the
    // next shadow must ignore `revenue` entirely.
    const sector = makeSector({
      plantsStartTurn: 900,
      revenue: 10_000,
      capitalStock: 100,
      legacyRevenueShadow: 500_000,
      legacyGrowthRateShadow: GROWTH_RATE,
      legacyTargetGrowthRateShadow: GROWTH_RATE,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const { update } = run("plants", sector, 1000);
    expect(update.legacyRevenueShadow as number).toBeCloseTo(
      500_000 * (1 + GROWTH_RATE / GROWTH_RATE_TURNS_PER_YEAR / 100),
      6
    );
  });
});

/**
 * Ticket #1072 follow-up. A nationalized CEO set the production adjustment to
 * −22% and nothing moved: the same tonnage came out, the surplus went unsold,
 * and with the whole market to themselves no price move could clear it.
 *
 * Two bugs, one cause. Tonnage was gated by the REVENUE curve (−5% at −25)
 * while the panel advertises the OUTPUT curve (−10% at −25), and the output
 * curve was then applied a second time on the way out, to the world-supply
 * ledger and the clearing offer only. So the plant built more than it could
 * ever offer and paid to hold the difference.
 */
describe("plants mode — production policy throttles real tonnage (#1072)", () => {
  const POLICY = -22;
  const throttled = (level: number) =>
    run(
      "plants",
      makeSector({
        capitalStock: IMPLIED_UNITS * CAPITAL_SEED_HEADROOM,
        plantsStartTurn: 900,
        productionPolicy: level,
        productionPolicyLevel: level,
      }),
      1000
    ).update.producedUnits as number;

  it("moves produced units by the OUTPUT curve the panel advertises", () => {
    const open = throttled(0);
    const cut = throttled(POLICY);
    expect(open).toBeGreaterThan(0);
    // −22 on a −10%-at−25 curve is −8.8%, not the −4.4% the revenue curve gave
    // and emphatically not the 0% the player measured.
    // 6dp, not exact: producedUnits is persisted rounded.
    expect(cut / open).toBeCloseTo(getOutputMultiplier(POLICY), 6);
    expect(cut).toBeLessThan(open);
  });

  it("offers every unit it produced, so a throttle creates no unsellable slice", () => {
    const produced = throttled(POLICY);
    const offered = plantsSupplyScaledUnits({
      producedUnits: produced,
      isNatcorp: false,
    })!;
    expect(offered).toBeCloseTo(produced, 10);
  });

  it("leaves an unthrottled sector exactly where it was", () => {
    const stock = IMPLIED_UNITS * CAPITAL_SEED_HEADROOM;
    const plain = run("plants", makeSector({ capitalStock: stock }), 1000);
    const capital = run("capital", makeSector({ capitalStock: stock }), 1000);
    expect(plain.result.hourlyRevenue).toBeCloseTo(capital.result.hourlyRevenue, 8);
  });
});

/**
 * Ticket #1072: cost is billed on what a plant PRODUCED, revenue is booked on
 * what it SOLD, and unsold output is not capitalised. A plant making 60k and
 * selling 10k therefore paid full freight against a sixth of the revenue, and
 * no amount of good management could close the gap.
 */
describe("plants mode — demand-aware production throttle", () => {
  const stock = IMPLIED_UNITS * CAPITAL_SEED_HEADROOM;

  /** producedUnits for a sector carrying last turn's sales history. */
  function producedWithHistory(
    history: { producedUnits?: number; soldUnits?: number } = {}
  ): number {
    return run(
      "plants",
      makeSector({ capitalStock: stock, plantsStartTurn: 100, ...history }),
      1000
    ).update.producedUnits as number;
  }

  it("cuts output toward what actually sold, instead of stockpiling losses", () => {
    const unthrottled = producedWithHistory();
    const glutted = producedWithHistory({
      producedUnits: unthrottled,
      soldUnits: unthrottled / 6,
    });
    expect(glutted).toBeLessThan(unthrottled);
    // Target is last turn's sales plus the probe margin.
    expect(glutted).toBeCloseTo((unthrottled / 6) * (1 + DEMAND_PROBE_MARGIN), 2);
  });

  it("leaves a sector with no sales history exactly where it was", () => {
    // Newly founded, or a world that has never run the clearing pre-pass —
    // there is nothing to infer a demand ceiling from.
    const capital = run("capital", makeSector({ capitalStock: stock }), 1000);
    const plants = run("plants", makeSector({ capitalStock: stock }), 1000);
    expect(plants.result.hourlyRevenue).toBeCloseTo(capital.result.hourlyRevenue, 8);
  });

  it("leaves a plant that cleared its whole run alone", () => {
    const unthrottled = producedWithHistory();
    const clearing = producedWithHistory({
      producedUnits: unthrottled,
      soldUnits: unthrottled,
    });
    expect(clearing).toBeCloseTo(unthrottled, 4);
  });

  it("never idles a plant completely after a turn with no sales", () => {
    // Zero output means zero presence on the clearing book, which would make
    // "sold nothing" permanent. Mothball is the deliberate way to stop.
    const unthrottled = producedWithHistory();
    const dead = producedWithHistory({ producedUnits: unthrottled, soldUnits: 0 });
    expect(dead).toBeCloseTo(unthrottled * DEMAND_THROTTLE_FLOOR, 2);
  });
});
