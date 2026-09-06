import {
  eraScaledBasePrices,
  demographicWealthMultiplier,
  type CommodityType,
} from "@/lib/constants/commodities";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Household Ledger — income-driven final consumer demand.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The legacy engine synthesises "consumer" demand from corporate retail revenue,
 * flat GDP fractions and a stabilizer — household income (`medianIncome`),
 * employment (`unemploymentRate`) and sentiment (`consumerConfidence`) are
 * computed every turn but never feed demand. This module closes that loop: a
 * per-state consumption budget that turns those household signals into demand
 * for a consumer basket, with a bounded price-elasticity response (buy less when
 * things get dear — demand destruction, a stabilizing negative feedback).
 *
 * Gated behind `householdConsumptionEnabled` (default off; uncalibrated — same
 * rollout posture as `demographicsDemandEnabled`). When enabled it also
 * supersedes retail's SECTOR_DEMAND input proxy (see `suppressRetailConsumerDemand`
 * in `computeRawSupplyDemand`) so consumers buy those basket commodities
 * directly — but the retail-commodity output self-loop stays (ticket #1026).
 *
 * Budget base: POPULATION, not GDP. Seed GDP (and medianIncome) is unit-
 * inconsistent across countries — several are inflated 10–1000× (e.g. NG/JP/IT
 * carry local-currency-scale GDP), which would let a mis-seeded country drive
 * global consumer demand. Population is the one cross-country-consistent field,
 * so consumption is sized as `population × per-capita spend`, and `wealthMult`
 * (which reads the unreliable GDP/capita) is demoted to tilting only the basket
 * COMPOSITION (Engel), never its size. Household signals enter as dimensionless
 * multipliers centred on 1, so missing metrics degrade to a flat per-capita
 * basket. `per-capita spend` is in millions of ₳/person/turn, so
 * `demand = budget × weight / basePrice` lands in the same "units" pool as the
 * rest of `computeRawSupplyDemand`.
 */

/**
 * Consumer spend per person per turn, in millions of ₳ (so population × this is
 * a ₳-millions budget, matching the demand pool's unit). The one calibration
 * knob (overridable per-world via `gameConfig.householdConsumptionPerCapita`).
 *
 * Calibrated against two live snapshots via the real pure functions:
 *   - turn-1 Beta-3 (near-empty, 17 sectors): consumer demand is a big share of
 *     a stabilizer-dominated market, so a little goes a long way.
 *   - turn-960 sandbox (mature, 63 sectors): supply is large, so the same
 *     population-based demand is gentler. At 0.002 the mature economy sees
 *     retail ~+12%, oversupplied consumer goods (food/healthcare/entertainment)
 *     nudged toward equilibrium, and pre-existing energy/electronics shortages
 *     ~unchanged. The mature economy is representative, so the default targets it.
 *
 * Because consumer demand scales with population (roughly fixed) while B2B supply
 * grows as players build, its relative price weight eases as the economy matures.
 */
export const HOUSEHOLD_CONSUMPTION_PER_CAPITA = 0.002;

/**
 * Plants-tier unit re-anchor for household demand (ticket #1027).
 *
 * `HOUSEHOLD_CONSUMPTION_PER_CAPITA` was calibrated against the LEGACY supply
 * pool, where sector supply was derived from revenue nameplates. Under plants
 * (`marketSystemMode >= "plants"`) supply became PHYSICAL `producedUnits` from
 * plants seeded at national-economy capacities (a single flipped NPP plant
 * carries 100k-300k units/day), while household demand stayed on the legacy
 * basis — two unit systems in one ledger. Measured live (turn 21, pop 1.5B,
 * 238 states): every plants-produced good sat 12-312x oversupplied (food 312x,
 * retail 167x, chemicals 72x), every finished-good price was pinned at the
 * log-curve floor (~0.55x base), and player plants cleared soldFraction
 * 0.003-0.08 — new-player corps earned single-digit currency per hour.
 *
 * This scale moves household demand onto the plants unit basis. Sizing: total
 * pop 1.5e9 x 0.002 x weight/basePrice puts food at ~3.9k units against 23.3M
 * supply; x3000 lands food fill ~0.4, consumer services 0.3-0.75, leaving
 * markets glutted enough that price signals and NPP growth governors still
 * bite, but cleared enough that a founder's plant sells a meaningful share of
 * its output. Physically: ~6kg food/person/day against the seed's ~15kg
 * produced — demand is anchored to the seeded supply scale, which is itself
 * inflated vs reality but is not re-seedable on live worlds.
 *
 * Applied ONLY when the caller passes `plantsUnitScale` (plants worlds);
 * legacy worlds are byte-identical. The per-world
 * `gameConfig.householdConsumptionPerCapita` override composes with it
 * (override replaces the per-capita base, scale still applies).
 */
export const PLANTS_HOUSEHOLD_UNIT_SCALE = 3000;

/**
 * Per-commodity ceiling on scaled household demand, as a multiple of the
 * PRIOR turn's global supply. Without it the re-anchor pins scarce goods to
 * the price cap: pharmaceuticals (in the basket at weight 0.03) had 4.2k
 * units of world supply against a would-be 225k of scaled household demand —
 * a 50x shortage no build-out could chase down. Households cannot consume
 * what was never produced; unmet demand beyond this multiple is treated as
 * destroyed (substitution), not carried as price pressure. 1.5x still leaves
 * genuinely scarce goods in clear shortage (price well above base) so the
 * build-here signal survives.
 */
export const PLANTS_HOUSEHOLD_SUPPLY_CAP = 1.5;

/**
 * Consumer basket weights over the commodities households actually buy (finished
 * goods + consumer services + the abstract `retail` bucket for general
 * merchandise). Raw extractables and pure-B2B inputs (ordnance, fertilizers) are
 * excluded. Weights are relative — they are renormalised per state after the
 * wealth-tier (Engel) shift — so they need not sum to exactly 1.
 */
export const HOUSEHOLD_CONSUMER_BASKET: Partial<Record<CommodityType, number>> = {
  food: 0.2,
  energy: 0.08,
  retail: 0.1,
  vehicles: 0.06,
  electronics: 0.05,
  pharmaceuticals: 0.03,
  healthcare_services: 0.09,
  real_estate_services: 0.1,
  financial_services: 0.05,
  network_services: 0.05,
  entertainment_services: 0.05,
  software: 0.03,
  freight: 0.03,
  advertising: 0.02,
  consulting_services: 0.02,
  building_materials: 0.02,
  plastics: 0.01,
  chemicals: 0.01,
};

/**
 * Engel's-law tier slopes: how each basket weight shifts as a state gets richer
 * (`wealthMult` above 1). Staples fall as a share of the wallet; discretionary
 * goods and services rise. `adjustedWeight = weight × (1 + slope × (wealthMult −
 * 1))`, floored at 0 and renormalised. Absent entries do not shift.
 */
const HOUSEHOLD_BASKET_TIER_SLOPE: Partial<Record<CommodityType, number>> = {
  food: -0.35,
  energy: -0.2,
  retail: -0.1,
  vehicles: 0.2,
  electronics: 0.25,
  entertainment_services: 0.3,
  financial_services: 0.3,
  real_estate_services: 0.2,
  healthcare_services: 0.15,
  software: 0.25,
};

/**
 * Own-price elasticity per basket commodity: staples are inelastic (you buy food
 * even when dear), discretionary goods elastic. Applied to the ratio of the prior
 * global price to base price, so demand falls when a commodity is above its base
 * and rises modestly when below — bounded by `ELASTICITY_CLAMP`.
 */
const HOUSEHOLD_PRICE_ELASTICITY: Partial<Record<CommodityType, number>> = {
  food: 0.1,
  energy: 0.15,
  healthcare_services: 0.1,
  pharmaceuticals: 0.1,
  retail: 0.3,
  vehicles: 0.6,
  electronics: 0.6,
  entertainment_services: 0.6,
  financial_services: 0.4,
  real_estate_services: 0.4,
  software: 0.5,
};
const DEFAULT_PRICE_ELASTICITY = 0.35;
const ELASTICITY_CLAMP: readonly [number, number] = [0.6, 1.3];

// Household-signal modulators — each dimensionless and centred on 1.0, so a
// missing/zero metric is a no-op (the ledger degrades to a pure GDP share).
const UNEMPLOYMENT_NEUTRAL = 5; // % unemployment that reads as "full employment"
const EMPLOYMENT_CLAMP: readonly [number, number] = [0.8, 1.12];
const CONFIDENCE_NEUTRAL = 60; // consumerConfidence neutral (~60 per stateMetrics)
const CONFIDENCE_CLAMP: readonly [number, number] = [0.85, 1.15];
const INCOME_CLAMP: readonly [number, number] = [0.7, 1.4];

const clamp = (v: number, [lo, hi]: readonly [number, number]): number =>
  Math.max(lo, Math.min(hi, v));

/** Per-state household economic signals (all optional — missing → neutral). */
export interface HouseholdStateSignals {
  medianIncome?: number;
  unemploymentRate?: number;
  consumerConfidence?: number;
}

export interface HouseholdConsumptionState {
  stateId: string;
  countryId?: string;
  gdp: number;
  population: number;
}

export interface HouseholdConsumptionInput {
  states: HouseholdConsumptionState[];
  /** stateId → household signals (from `stateMetrics.economic`). */
  metricsByState: Map<string, HouseholdStateSignals>;
  /** commodity → prior global price; falls back to base price when absent. */
  priorGlobalPrice?: Map<CommodityType, number>;
  /** Calibration override (millions ₳/person/turn) for tests / sandbox tuning. */
  perCapita?: number;
  /**
   * The world's era unit-basis scale (`getEraUnitScale(preset)`); absent ⇒ 1.
   * `perCapita` is a MODERN ₳ constant, so on an era basis it is deflated to
   * the era's money and divided by the era base-price table — the two moves
   * cancel in the unit count (household demand is population-anchored and
   * therefore already real), but the price-elasticity ratio below compares
   * against prior prices the ledger now stores at ERA levels, and a modern
   * base in that ratio would read every era price as a ~70x crash.
   */
  eraUnitScale?: number;
  /**
   * Plants-tier unit re-anchor (see `PLANTS_HOUSEHOLD_UNIT_SCALE`). Callers on
   * plants worlds pass the scale constant; absent/1 is a pure no-op so every
   * legacy caller stays byte-identical.
   */
  plantsUnitScale?: number;
  /**
   * Prior turn's GLOBAL supply per commodity, for the `PLANTS_HOUSEHOLD_SUPPLY_CAP`
   * clamp. Only consulted when `plantsUnitScale > 1`. A commodity absent from
   * the map (never priced) is left unclamped.
   */
  priorGlobalSupply?: Map<CommodityType, number>;
}

export interface HouseholdConsumptionResult {
  /** commodity → total demand units to add globally. */
  global: Map<CommodityType, number>;
  /** stateId → commodity → demand units to add for that state. */
  byState: Map<string, Map<CommodityType, number>>;
  /**
   * commodity → household demand units removed by the PLANTS_HOUSEHOLD_SUPPLY_CAP
   * clamp this turn. Recorded, not applied: the cap makes every recorded
   * shortage a property of the cap, so the truncated amount is the only way
   * to see how short the world really is (#1460).
   */
  truncated: Map<CommodityType, number>;
}

const BASKET_ENTRIES = Object.entries(HOUSEHOLD_CONSUMER_BASKET) as [CommodityType, number][];

/** Average `medianIncome` per country, for the relative-income modulator. */
function countryIncomeAverages(
  states: HouseholdConsumptionState[],
  metricsByState: Map<string, HouseholdStateSignals>
): Map<string, number> {
  const sum = new Map<string, { total: number; n: number }>();
  for (const s of states) {
    const income = metricsByState.get(s.stateId)?.medianIncome;
    if (!s.countryId || !(income && income > 0)) continue;
    const acc = sum.get(s.countryId) ?? { total: 0, n: 0 };
    acc.total += income;
    acc.n += 1;
    sum.set(s.countryId, acc);
  }
  const avg = new Map<string, number>();
  for (const [cid, { total, n }] of sum) if (n > 0) avg.set(cid, total / n);
  return avg;
}

/**
 * Compute per-state household consumer demand. Pure: returns demand-unit
 * contributions to fold into the raw supply/demand pool. Never mutates inputs.
 */
export function computeHouseholdConsumption(
  input: HouseholdConsumptionInput
): HouseholdConsumptionResult {
  const {
    states,
    metricsByState,
    priorGlobalPrice,
    perCapita = HOUSEHOLD_CONSUMPTION_PER_CAPITA,
    eraUnitScale = 1,
    plantsUnitScale = 1,
    priorGlobalSupply,
  } = input;
  const basePrices = eraScaledBasePrices(eraUnitScale);
  const unitScale = plantsUnitScale > 0 ? plantsUnitScale : 1;
  const eraPerCapita = (perCapita * unitScale) / (eraUnitScale > 0 ? eraUnitScale : 1);

  const global = new Map<CommodityType, number>();
  const truncated = new Map<CommodityType, number>();
  const byState = new Map<string, Map<CommodityType, number>>();
  const incomeAvgByCountry = countryIncomeAverages(states, metricsByState);

  for (const state of states) {
    const { stateId, countryId, gdp, population } = state;
    if (!(population > 0)) continue; // budget is population-anchored; gdp only tilts the basket

    const signals = metricsByState.get(stateId) ?? {};
    // wealthMult reads GDP/capita (unreliable across countries) — used ONLY to
    // tilt basket composition (Engel), never to size the budget.
    const wealthMult = demographicWealthMultiplier(gdp, population);

    // ── Dimensionless household modulators (each centred on 1.0) ──────────────
    const employmentMod =
      signals.unemploymentRate != null
        ? clamp((100 - signals.unemploymentRate) / (100 - UNEMPLOYMENT_NEUTRAL), EMPLOYMENT_CLAMP)
        : 1;
    const confidenceMod =
      signals.consumerConfidence != null && signals.consumerConfidence > 0
        ? clamp(signals.consumerConfidence / CONFIDENCE_NEUTRAL, CONFIDENCE_CLAMP)
        : 1;
    const countryAvgIncome = countryId ? incomeAvgByCountry.get(countryId) : undefined;
    const incomeMod =
      signals.medianIncome != null && signals.medianIncome > 0 && countryAvgIncome
        ? clamp(signals.medianIncome / countryAvgIncome, INCOME_CLAMP)
        : 1;

    const budget = population * eraPerCapita * employmentMod * confidenceMod * incomeMod;
    if (!(budget > 0)) continue;

    // ── Wealth-tier (Engel) shift + renormalise the basket for this state ─────
    const tierWeights: [CommodityType, number][] = [];
    let weightSum = 0;
    for (const [commodity, baseWeight] of BASKET_ENTRIES) {
      const slope = HOUSEHOLD_BASKET_TIER_SLOPE[commodity] ?? 0;
      const w = Math.max(0, baseWeight * (1 + slope * (wealthMult - 1)));
      tierWeights.push([commodity, w]);
      weightSum += w;
    }
    if (!(weightSum > 0)) continue;

    const stateContribution = new Map<CommodityType, number>();
    for (const [commodity, w] of tierWeights) {
      if (w <= 0) continue;
      const basePrice = basePrices[commodity];
      if (!(basePrice > 0)) continue;

      // ── Bounded own-price elasticity (demand destruction) ───────────────────
      const priorPrice = priorGlobalPrice?.get(commodity) ?? basePrice;
      const priceRatio = priorPrice > 0 ? priorPrice / basePrice : 1;
      const elasticity = HOUSEHOLD_PRICE_ELASTICITY[commodity] ?? DEFAULT_PRICE_ELASTICITY;
      const elasticMod = clamp(Math.pow(priceRatio, -elasticity), ELASTICITY_CLAMP);

      const units = ((budget * (w / weightSum)) / basePrice) * elasticMod;
      if (!(units > 0)) continue;

      stateContribution.set(commodity, units);
      global.set(commodity, (global.get(commodity) ?? 0) + units);
    }
    if (stateContribution.size > 0) byState.set(stateId, stateContribution);
  }

  // ── Plants supply clamp (see PLANTS_HOUSEHOLD_SUPPLY_CAP) ──────────────────
  // Applied AFTER the state loop so the cap is on the world total, and each
  // state's contribution is scaled by the same factor — state shares are
  // preserved, only the magnitude is cut.
  if (unitScale > 1 && priorGlobalSupply) {
    for (const [commodity, total] of global) {
      const supply = priorGlobalSupply.get(commodity);
      if (!(typeof supply === "number" && supply > 0)) continue;
      const cap = supply * PLANTS_HOUSEHOLD_SUPPLY_CAP;
      if (total <= cap) continue;
      const factor = cap / total;
      truncated.set(commodity, total - cap);
      global.set(commodity, cap);
      for (const contrib of byState.values()) {
        const v = contrib.get(commodity);
        if (v != null) contrib.set(commodity, v * factor);
      }
    }
  }

  return { global, byState, truncated };
}
