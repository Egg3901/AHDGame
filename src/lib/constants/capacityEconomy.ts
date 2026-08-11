/**
 * Capacity economy anchors — what a unit of productive capacity COSTS and how
 * many workers it TAKES (P1 of the "buildable sectors" plan).
 *
 * ─── Why this module exists ────────────────────────────────────────────────
 * Today there is no ₳-per-unit-of-capacity price anywhere in the game. Under
 * `marketSystemMode >= "capital"` a sector owns `capitalStock` measured in
 * OUTPUT UNITS PER DAY (see `lib/market/capital.ts`), but that stock grows
 * *multiplicatively* off the growth slider (`advanceCapitalStock`: stock ×
 * (1 + g − δ)) while cash is charged by a completely separate formula
 * (`calculateDailyGrowthCost`: revenue × g × GROWTH_COST_MULTIPLIER × …).
 * The two are never reconciled: nothing in the codebase says "one unit/day of
 * capacity costs X ₳" or "one unit/day of capacity needs Y workers".
 *
 * Later phases make capacity something a corp BUYS with cash and STAFFS with
 * workers. This module is the pricing table those phases will read. It is
 * **purely additive and unreferenced by production code in this phase** — no
 * behavior changes until a later phase calls it.
 *
 * ─── Calibration principle: no-op by construction ──────────────────────────
 * Both anchors are DERIVED IN CODE from the tables the live economy already
 * uses (`COMMODITY_BASE_PRICES`, `SECTOR_STRATEGIES`, `REVENUE_PER_WORKER`
 * via `calculateWorkers`, `GROWTH_COST_MULTIPLIER`). Nothing here is a
 * hand-typed number that could silently desync when those base tables drift:
 * change a base price or a strategy's supply rates and these anchors move with
 * them, automatically. At the 1953 anchor era the tables reproduce today's
 * observed economics exactly, so the eventual cutover is a no-op at flip.
 *
 * ─── The unit-mix pivot: `revenuePerCapacityUnit` ──────────────────────────
 * Everything below hangs off one quantity. `impliedOutputUnits`
 * (capital.ts:99-113) is
 *
 *     units(revenue) = Σ_c  revenue × rate_c / basePrice_c
 *                    = revenue × Σ_c (rate_c / basePrice_c)
 *
 * — it SUMS raw units across the whole output mix (tons of steel plus MWh of
 * energy plus …; the game deliberately treats them as commensurable "units").
 * Define the unit yield
 *
 *     k(type) = Σ_c (rate_c / basePrice_c)      [units per ₳ of daily revenue]
 *
 * and its reciprocal, the revenue one unit/day of capacity earns at full
 * utilization:
 *
 *     revenuePerCapacityUnit(type) = 1 / k(type)               (RPU)
 *
 * JUDGMENT CALL (documented deliberately): the obvious "average price of the
 * output mix" is the rate-weighted arithmetic mean Σ(rate_c × basePrice_c) /
 * Σ rate_c. That is NOT what the engine computes. Because `impliedOutputUnits`
 * divides each leg by its own base price and then sums the resulting unit
 * counts, the correct inverse is the reciprocal-of-a-sum above — a
 * *harmonic-style* mix, which is dominated by the CHEAP legs of the mix (a
 * $25/MMBtu gas leg contributes far more units per ₳ than a $25,000/vehicle
 * leg). Using the arithmetic mean would over-price capacity by a large factor
 * for any sector with a mixed-price output basket (energy, extraction,
 * automobiles). RPU as defined is exactly the ₳ of revenue that one unit of
 * `capitalStock` supports, which is the only definition that makes the two
 * identities below self-consistent with `capitalUtilizationFactor`.
 *
 * ─── Anchor identity A (labour) ────────────────────────────────────────────
 * `calculateWorkers` (corporations.ts:270-280) is
 *
 *     workers = (revenue / REVENUE_PER_WORKER) × skillMult,   skillMult = 1 at
 *                                                             workforceSkill 50
 *
 * and capacity implied by that same revenue is units = revenue × k. So at the
 * neutral-skill reference point:
 *
 *     laborIntensity = workers / units
 *                    = (revenue / REVENUE_PER_WORKER) / (revenue × k)
 *                    = 1 / (REVENUE_PER_WORKER × k)
 *                    = RPU(type) / REVENUE_PER_WORKER            ◀ IDENTITY A
 *
 * The representative revenue CANCELS — the anchor is scale-free, which is why
 * no "representative revenue" constant appears in this file. Skill enters as a
 * multiplier at the call site later (a skill-100 state staffs the same capacity
 * with 0.70× the workers); the anchor is the skill-50 baseline.
 *
 * ─── Anchor identity B (price) ─────────────────────────────────────────────
 * The legacy growth system charges (post-#3934 clock fix, corporations.ts:520-590)
 * an effective GROWTH_COST_MULTIPLIER × the revenue the growth actually adds,
 * for capacity delivered over one game year:
 *
 *     cashOverOneGameYear = GROWTH_COST_MULTIPLIER × Δrevenue
 *
 * and that Δrevenue corresponds to Δunits = Δrevenue × k of extra capacity
 * (same `impliedOutputUnits` map). Therefore
 *
 *     capacityPricePerUnit = cash / Δunits
 *                          = GROWTH_COST_MULTIPLIER × Δrevenue / (Δrevenue × k)
 *                          = GROWTH_COST_MULTIPLIER × RPU(type)   ◀ IDENTITY B
 *
 * Again scale-free. Note both identities are ratios of the SAME cancelling
 * Δrevenue, so A and B are consistent with each other by construction:
 * capacityPricePerUnit / laborIntensity = GROWTH_COST_MULTIPLIER ×
 * REVENUE_PER_WORKER for every sector type, in every era with matching era
 * columns — a relationship the tests pin.
 *
 * The rate/dominance/acumen multipliers in `calculateDailyGrowthCost` are
 * deliberately EXCLUDED: they are situational modifiers on a transaction, not
 * properties of the capacity good. The future build system applies its own
 * modifiers on top of this base price, exactly as the growth path does today.
 *
 * ─── Era scaling ───────────────────────────────────────────────────────────
 * Both lookups follow the era-span step pattern of `constants/monetaryEra.ts`
 * (spans listed most-historical-first; the first span whose `untilYear` exceeds
 * the year wins; ≥ MODERN_ERA_START_YEAR resolves the modern row). Step, not
 * interpolation — same as monetaryEra, and the same reason: these are authored
 * regime anchors, not a measured series, and a step keeps a world's numbers
 * stable within an era instead of drifting every turn.
 *
 * The 1953 row of BOTH columns is exactly 1.0. That is the calibration anchor:
 * at 1953 the functions return the raw identities above, so a 1953 world's
 * numbers reproduce today's economics exactly. Everything else is PROVISIONAL
 * and will be re-tuned by worldsim.
 */

import {
  CORPORATION_TYPES,
  GROWTH_COST_MULTIPLIER,
  acumenGrowthCostMultiplier,
  acumenRateSensitivity,
  getDominanceGrowthCostMultiplier,
  type CorporationType,
} from "./corporations";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import { COMMODITY_BASE_PRICES, type CommodityType } from "./commodities";
import { SECTOR_STRATEGIES, getStrategy } from "./sectorStrategies";
import { MODERN_ERA_START_YEAR } from "./monetaryEra";
import { eraLaborMultiplier } from "@/lib/labour/laborCost";

/**
 * Revenue per worker used by `calculateWorkers`. That constant is module-private
 * in `corporations.ts` (and owned by another agent this phase, so it is not
 * being exported there). It is re-stated here as the single place identity A
 * reads it from; `capacityEconomy.test.ts` pins it against the live behavior of
 * `calculateWorkers` so the two can never silently diverge.
 */
export const CAPACITY_REVENUE_PER_WORKER = 2_000;

/** The era whose anchors are the exact calibration point (era columns = 1.0). */
export const CAPACITY_ANCHOR_YEAR = 1953;

/**
 * The strategy id every sector's baseline (ungated, non-tech-tree) operating
 * method carries. `getStrategy` and every read site in the codebase default to
 * it (`sector.strategyId ?? "standard"`).
 */
const DEFAULT_STRATEGY_ID = "standard";

/**
 * The output mix a sector is priced against: its default ("standard") strategy,
 * falling back to the first ungated strategy and finally to the first listed —
 * mirroring `getStrategy`'s fallback, but skipping tech-tree/decade-gated
 * strategies, which cannot be a 1953 world's baseline.
 */
export function defaultSupplyRates(
  sectorType: CorporationType
): Partial<Record<CommodityType, number>> {
  const strategies = SECTOR_STRATEGIES[sectorType] ?? [];
  const chosen =
    strategies.find((s) => s.id === DEFAULT_STRATEGY_ID) ??
    strategies.find((s) => !s.requiresTechUnlock && !s.minDecade) ??
    strategies[0];
  return chosen?.supply ?? {};
}

/**
 * Unit yield k(type): output units per ₳ of daily revenue, exactly the
 * per-revenue slope of `impliedOutputUnits`.
 *
 * `unitScale` is the world's era unit-basis scale (`getEraUnitScale(preset)`,
 * 1 for every modern world, ~70 for 1953): the base-price table below is
 * 2019-calibrated, and a pre-modern world's ₳ figures are era-nominal, so
 * without the scale a "unit" stays a modern-sized quantum and the era's whole
 * economy collapses into a handful of units. The scale is REQUIRED, not
 * defaulted, so the compiler enumerates every conversion site — a site that
 * converts ₳→units with the scale and units→₳ without it drifts the two legs
 * of a stored pair by the era ratio, silently and permanently.
 */
export function capacityUnitYield(sectorType: CorporationType, unitScale: number): number {
  const supply = defaultSupplyRates(sectorType);
  let k = 0;
  for (const commodity of Object.keys(supply) as CommodityType[]) {
    const rate = supply[commodity] ?? 0;
    const base = COMMODITY_BASE_PRICES[commodity];
    if (rate > 0 && base > 0) k += rate / base;
  }
  return k * safeUnitScale(unitScale);
}

/** Garbage-tolerant guard: a missing/non-finite/non-positive scale means 1 (modern basis). */
export function safeUnitScale(unitScale: number | null | undefined): number {
  return typeof unitScale === "number" && Number.isFinite(unitScale) && unitScale > 0
    ? unitScale
    : 1;
}

/**
 * RPU — ₳ of daily revenue that one unit/day of capacity supports at full
 * utilization. Reciprocal of {@link capacityUnitYield}, so it carries the
 * era unit scale in the denominator: one 1953 unit earns era-scale ₳.
 */
export function revenuePerCapacityUnit(sectorType: CorporationType, unitScale: number): number {
  const k = capacityUnitYield(sectorType, unitScale);
  return k > 0 ? 1 / k : 0;
}

// ─── D9: capacity is ONE currency, but its VALUE is strategy-dependent ───────

/**
 * Unit yield k for an ARBITRARY output mix (not just the default strategy's).
 * Same Σ(rate_c / basePrice_c) the engine's `impliedOutputUnits` applies.
 */
export function unitYieldForSupply(
  supply: Partial<Record<CommodityType, number>>,
  unitScale: number
): number {
  let k = 0;
  for (const commodity of Object.keys(supply ?? {}) as CommodityType[]) {
    const rate = supply[commodity] ?? 0;
    const base = COMMODITY_BASE_PRICES[commodity];
    if (rate > 0 && base > 0) k += rate / base;
  }
  return k * safeUnitScale(unitScale);
}

/**
 * RPU for a SPECIFIC strategy of a sector type — ₳ of daily revenue one unit/day
 * of capacity supports while the sector runs that production method.
 *
 * `revenuePerCapacityUnit` above is this evaluated at the sector's default
 * ("standard") strategy; the build-price anchor is deliberately priced there, so
 * capacity has one price regardless of what you later point it at (D9). This
 * function is the other half of D9: the price is strategy-blind, so the STOCK
 * has to be renormalized when the strategy changes.
 *
 * Returns 0 for a sector type with no strategy table at all — `getStrategy`
 * THROWS on an unknown type, and this runs inside player-facing retool routes
 * where a legacy/garbage `sectorType` must degrade to "no rescale", never to a
 * 500. `capacityRescaleRatio` reads 0 as "nothing to do" and returns 1.
 */
export function revenuePerCapacityUnitForStrategy(
  sectorType: CorporationType,
  strategyId: string | null | undefined,
  unitScale: number
): number {
  if (!SECTOR_STRATEGIES[sectorType]?.length) return 0;
  const strategy = getStrategy(sectorType, strategyId ?? DEFAULT_STRATEGY_ID);
  const k = unitYieldForSupply(strategy?.supply ?? {}, unitScale);
  return k > 0 ? 1 / k : 0;
}

/**
 * D9 — RPU NORMALIZATION AT THE RETOOL BOUNDARY.
 *
 * `capitalStock` is a count of "output units per day". Under plants the sector's
 * nameplate is `capitalStock × mixPrice`, and `mixPrice` is exactly the RPU of
 * whatever strategy the sector is running (mixPrice = revenue / units =
 * 1 / Σ(rate/base) = RPU — see `plantsMixPrice` in sectorTurn). Those units are
 * NOT commensurable across production methods: a coal miner's mix prices at
 * ~$60/unit while a rare-earth miner's prices in the tens of thousands, so a
 * coal→rare-earth retool would re-price the very same physical plant by 140-327×
 * — capacity you never built and never paid for, conjured by a $250k retool fee.
 *
 * The fix is to re-scale the STOCK so the NAMEPLATE is invariant across the
 * retool:
 *
 *     capacity_new × RPU_new = capacity_old × RPU_old
 *     capacity_new = capacity_old × RPU_old / RPU_new
 *
 * Read plainly: a plant worth ₳X/day of output is still worth ₳X/day of output
 * the moment after you decide to point it at a different product. What changes
 * afterwards is what the market pays for that output (price realization), the
 * transition margin penalty, and the retool fee — all of which already exist.
 * Retooling is a re-aim, not a capital grant.
 *
 * TRANSITION WINDOW (deliberate, documented simplification): the engine blends
 * the two strategies' rates linearly over `STRATEGY_TRANSITION_TURNS` (12) via
 * `getEffectiveStrategyRates`, so mid-transition the sector's effective mixPrice
 * sits between RPU_old and RPU_new while its stock has ALREADY been rescaled to
 * the destination. The nameplate therefore misprices during the blend. We accept
 * that, and rescale ONCE at commit using the FINAL rates, because:
 *   - the error is bounded by the RPU ratio and decays linearly to exactly 0 at
 *     the end of the window (12 turns = half a financial day);
 *   - the alternative (re-scaling every turn against the blended rates) makes
 *     `capitalStock` a derived quantity that moves under the sector's feet every
 *     turn of the window, which would fight depreciation, the build queue and
 *     the flip migration, all of which treat the stock as owned state;
 *   - a one-shot rescale at a player-initiated boundary is auditable; a
 *     per-turn one is not.
 *
 * Returns `capitalStock` unchanged when there is nothing meaningful to do (no
 * stock, a strategy with no priced output on either side, a non-finite input) —
 * a sector with no priced mix has no nameplate to keep invariant.
 */
export function rescaleCapacityForStrategyChange(
  capitalStock: number | null | undefined,
  sectorType: CorporationType,
  fromStrategyId: string | null | undefined,
  toStrategyId: string | null | undefined
): number {
  const stock =
    typeof capitalStock === "number" && Number.isFinite(capitalStock) ? capitalStock : 0;
  if (stock <= 0) return stock;
  const ratio = capacityRescaleRatio(sectorType, fromStrategyId, toStrategyId);
  return stock * ratio;
}

/**
 * The bare RPU_old / RPU_new ratio {@link rescaleCapacityForStrategyChange}
 * applies. Exported because build orders IN FLIGHT must move by the same factor:
 * `unitsOrdered` is denominated in the same units as `capitalStock`, so an order
 * placed under the old mix would otherwise land as mispriced capacity. Their
 * `costPaidAnchor` is deliberately NOT touched — that is cash already spent, and
 * CIP / the cancellation refund must keep reporting the ₳ actually paid.
 *
 * Returns exactly 1 whenever the rescale is undefined or a no-op.
 */
export function capacityRescaleRatio(
  sectorType: CorporationType,
  fromStrategyId: string | null | undefined,
  toStrategyId: string | null | undefined
): number {
  if ((fromStrategyId ?? DEFAULT_STRATEGY_ID) === (toStrategyId ?? DEFAULT_STRATEGY_ID)) return 1;
  // The era unit scale cancels in the from/to ratio, so this stays scale-free
  // by construction (passing the world's real scale would change nothing).
  const rpuFrom = revenuePerCapacityUnitForStrategy(sectorType, fromStrategyId, 1);
  const rpuTo = revenuePerCapacityUnitForStrategy(sectorType, toStrategyId, 1);
  if (!(rpuFrom > 0) || !(rpuTo > 0) || !Number.isFinite(rpuFrom / rpuTo)) return 1;
  return rpuFrom / rpuTo;
}

/**
 * Apply the retool rescale to a whole build queue, in place-free form.
 * `unitsOrdered` scales; everything else (paid cash, turn stamps) is untouched.
 */
export function rescaleBuildQueueForStrategyChange<T extends { unitsOrdered: number }>(
  queue: readonly T[] | null | undefined,
  ratio: number
): T[] {
  if (!Array.isArray(queue) || queue.length === 0) return [];
  if (!Number.isFinite(ratio) || ratio === 1) return [...queue];
  return queue.map((order) => ({
    ...order,
    unitsOrdered:
      Number.isFinite(order.unitsOrdered) && order.unitsOrdered > 0
        ? order.unitsOrdered * ratio
        : order.unitsOrdered,
  }));
}

// ─── Tech output multiplier, expressed in CAPACITY units ─────────────────────

/**
 * The scalar by which a tech tree's per-commodity `outputRateMult` raises the
 * UNITS a given capacity produces.
 *
 * `sectorTurn` already applies `outputRateMult` to the supply rates it reports
 * to the commodity ledger (`effectiveSupply`). Under plants that left the tech
 * effect half-wired: the world saw more steel arrive, but the sector's own
 * `producedUnits` — and therefore its derived revenue — never moved, because
 * units come from `capitalStock`, not from the supply rates. This closes it.
 *
 * The honest scalar is the ratio of unit yields under the scaled vs. unscaled
 * mix — exactly what `impliedOutputUnits` would return for the same revenue:
 *
 *     mult = Σ(rate_c × m_c / base_c) / Σ(rate_c / base_c)
 *
 * i.e. a commodity-weighted average of the per-commodity multipliers, weighted
 * by each leg's contribution to unit count. Returns exactly 1 for an empty
 * multiplier map (every corp without the tech, and every world with the tech
 * tree off), which is what keeps the flip identity exact.
 */
export function techOutputUnitsMultiplier(
  supply: Partial<Record<CommodityType, number>> | null | undefined,
  outputRateMult: Record<string, number> | null | undefined
): number {
  if (!supply || !outputRateMult || Object.keys(outputRateMult).length === 0) return 1;
  let base = 0;
  let scaled = 0;
  for (const commodity of Object.keys(supply) as CommodityType[]) {
    const rate = supply[commodity] ?? 0;
    const price = COMMODITY_BASE_PRICES[commodity];
    if (!(rate > 0) || !(price > 0)) continue;
    const contribution = rate / price;
    const mult = outputRateMult[commodity];
    base += contribution;
    scaled += contribution * (Number.isFinite(mult) && mult > 0 ? mult : 1);
  }
  return base > 0 ? scaled / base : 1;
}

// ─── Era columns ────────────────────────────────────────────────────────────

/**
 * PROVISIONAL era price column. Normalized so the 1953 anchor row is exactly
 * 1.0.
 *
 * The LABOUR era column deliberately has no table here — it is derived live by
 * {@link capacityEraLaborIndex} from the existing `eraLaborMultiplier` curve in
 * `lib/labour/laborCost.ts` (1.35 pre-1953 / 1.25 from 1953 / 1.1 from 1991 /
 * 1.0 from 2007), renormalized to 1.0 at 1953 (i.e. divided by 1.25). That
 * curve is the codebase's existing statement of "older eras take more labour
 * per unit of economic activity", so reusing it keeps capacity staffing
 * consistent with the labour-cost model instead of asserting a second,
 * conflicting productivity history — and a re-tune there propagates here
 * automatically. Copying its numbers into a table below would just create a
 * second thing to desync. Note its tiers (2007, 1991, 1953) do NOT line up
 * with the price spans below; that is intentional, they are different claims.
 *
 * `priceIndex` is a nominal price-level index (a 1953 ₳ builds more capacity
 * than a 1999 ₳). Values are gameplay-rounded against the eras this game
 * models, roughly tracking the cumulative price level of the industrial world
 * across the spans monetaryEra already uses. FLAGGED PROVISIONAL: worldsim will
 * re-tune this column, and nothing in this phase depends on it being right.
 */
const CAPACITY_ERA_PRICE_SPANS: ReadonlyArray<{ untilYear: number; priceIndex: number }> = [
  // 1953 era — THE CALIBRATION ANCHOR. Exactly 1.0 by definition; do not
  // "tune" this row without re-deriving identity B above.
  { untilYear: 1971, priceIndex: 1.0 },
  // 1971-78, post-Bretton-Woods. PROVISIONAL.
  { untilYear: 1979, priceIndex: 1.4 },
  // 1979-90, the great-inflation hangover. PROVISIONAL.
  { untilYear: 1991, priceIndex: 2.6 },
  // 1991-98. PROVISIONAL.
  { untilYear: MODERN_ERA_START_YEAR, priceIndex: 3.6 },
];

/** Modern row (year ≥ MODERN_ERA_START_YEAR, or no year given). PROVISIONAL. */
const CAPACITY_ERA_MODERN_PRICE_INDEX = 5.0;

/**
 * Price-column era multiplier. Lookup is the same shape as
 * `monetaryEra.resolveEraTable`: spans most-historical-first, first span whose
 * `untilYear` exceeds the year wins, anything later (or a missing/garbage
 * year) resolves the modern row. There is no era before 1953, so the 1953 row
 * also covers earlier years. PROVISIONAL beyond the 1953 anchor.
 */
export function capacityEraPriceIndex(year: number | null | undefined): number {
  if (typeof year !== "number" || !Number.isFinite(year)) {
    return CAPACITY_ERA_MODERN_PRICE_INDEX;
  }
  for (const span of CAPACITY_ERA_PRICE_SPANS) {
    if (year < span.untilYear) return span.priceIndex;
  }
  return CAPACITY_ERA_MODERN_PRICE_INDEX;
}

/**
 * Labour-column era multiplier, derived live from `eraLaborMultiplier` and
 * renormalized to 1.0 at the 1953 anchor (the era table above documents the
 * resulting values; this function is the source of truth).
 */
export function capacityEraLaborIndex(year: number | null | undefined): number {
  const anchor = eraLaborMultiplier(CAPACITY_ANCHOR_YEAR);
  const here = eraLaborMultiplier(
    typeof year === "number" && Number.isFinite(year) ? year : undefined
  );
  return anchor > 0 ? here / anchor : 1;
}

// ─── Public anchors ─────────────────────────────────────────────────────────

/**
 * IDENTITY B — ₳ to build one unit/day of capacity in `sectorType`, at the
 * world's current `year`.
 *
 *     capacityPricePerUnit = GROWTH_COST_MULTIPLIER × RPU(type) × eraPriceIndex(year)
 *
 * At `year = 1953` the era index is 1.0, so this is exactly the ₳ the legacy
 * growth path charges for the same increment of capacity.
 */
export function capacityPricePerUnit(
  sectorType: CorporationType,
  year: number,
  unitScale: number
): number {
  return (
    GROWTH_COST_MULTIPLIER *
    revenuePerCapacityUnit(sectorType, unitScale) *
    capacityEraPriceIndex(year)
  );
}

/**
 * IDENTITY A — workers needed to staff one unit/day of capacity in
 * `sectorType`, at the world's current `year`, at neutral workforce skill (50).
 *
 *     laborIntensity = RPU(type) / CAPACITY_REVENUE_PER_WORKER × eraLaborIndex(year)
 *
 * At `year = 1953` the era index is 1.0, so a sector staffed from this table
 * carries exactly the headcount `calculateWorkers` gives it today.
 */
export function laborIntensity(
  sectorType: CorporationType,
  year: number,
  unitScale: number
): number {
  // RPU carries the era unit scale in its denominator, so workers-per-unit
  // shrinks by the same factor unit counts grow — total staffing for a given
  // real capacity is era-invariant.
  return (
    (revenuePerCapacityUnit(sectorType, unitScale) / CAPACITY_REVENUE_PER_WORKER) *
    capacityEraLaborIndex(year)
  );
}

// ─── Construction time ──────────────────────────────────────────────────────

/**
 * PROVISIONAL construction times, in TURNS, to deliver a capacity build.
 *
 * There is no observed quantity to calibrate against — the legacy growth path
 * delivers capacity continuously with no build lag at all — so unlike the two
 * anchors above these are authored, not derived. The shape is the only claim
 * being made: heavy, sited, permit-bound industry is slow; asset-light retail
 * and services are fast. Scale reference: 24 turns = one financial day,
 * 48 turns = one game year (see TURNS_PER_DAY / GROWTH_RATE_TURNS_PER_YEAR),
 * so 96 turns ≈ two game years for a refinery-class build.
 *
 * FLAGGED PROVISIONAL: worldsim re-tunes this whole table.
 */
const CAPACITY_BUILD_TURNS_TABLE: Record<CorporationType, number> = {
  // Heavy / sited / permit-bound.
  energy: 96,
  extraction: 96,
  chemical_industries: 84,
  manufacturing: 72,
  automobiles: 72,
  defense: 72,
  telecommunications: 60,
  real_estate: 60,
  construction: 48,
  healthcare: 48,
  agriculture: 48,
  logistics: 36,
  entertainment: 24,
  media: 24,
  financial: 24,
  technology: 24,
  // Asset-light: a store fit-out is weeks, not years.
  retail: 12,
};

/** Fallback for an unrecognized sector type (mid-table). */
export const CAPACITY_BUILD_TURNS_DEFAULT = 48;

/** PROVISIONAL — turns to complete a capacity build in `sectorType`. */
export function CAPACITY_BUILD_TURNS(sectorType: CorporationType): number {
  return CAPACITY_BUILD_TURNS_TABLE[sectorType] ?? CAPACITY_BUILD_TURNS_DEFAULT;
}

/** Every sector type, for exhaustive iteration in tests and tooling. */
export const CAPACITY_SECTOR_TYPES: ReadonlyArray<CorporationType> = CORPORATION_TYPES;

// ─── P3a: build orders, mothballing, idle upkeep ────────────────────────────

/**
 * Share of a cancelled build order's paid cost that is refunded (D10).
 *
 * Deliberately NOT 1.0. A cancelled order has already consumed siting,
 * permitting, engineering and part of the physical build; a full refund would
 * make the queue a free option — order capacity every turn, cancel whatever the
 * market no longer wants, pay nothing. 0.75 leaves a real but non-punitive cost
 * to changing your mind.
 */
export const CAPACITY_BUILD_CANCEL_REFUND = 0.75;

/**
 * Upkeep a MOTHBALLED sector pays, as a fraction of the maintenance its full
 * capacity would cost while running (D12). A mothballed plant produces nothing
 * and offers nothing, but it is not free: the site is still held, maintained
 * against corrosion and staffed by a care-and-maintenance crew. 0.2 makes
 * mothballing a large saving (80%) without making it strictly better than
 * running a marginal plant.
 */
export const MOTHBALL_UPKEEP_FRACTION = 0.2;

/**
 * Share of the pro-rata maintenance cost that IDLE (built but unused) capacity
 * still carries under plants.
 *
 * Before this, maintenance was derived purely from realized revenue, so a
 * sector running at 40% utilization paid 40% of the maintenance — idle plants
 * were free to hold. That makes over-building costless and removes the whole
 * point of a capacity decision. 0.3 says: an idle plant costs about a third of
 * what a running one costs (fixed site/maintenance/skeleton crew), which is
 * also why {@link MOTHBALL_UPKEEP_FRACTION} sits below it — mothballing is the
 * deliberate, cheaper alternative to holding a plant idle-but-ready.
 *
 * Effective cost basis under plants = utilization + 0.3 × (1 − utilization).
 */
export const IDLE_UPKEEP_FRACTION = 0.3;

/**
 * Price multiplier on the FOUNDING build of a newly created sector.
 *
 * Founding a sector today (`expandSector`) costs SECTOR_EXPANSION_BASE_COST
 * (100k ₳) and GRANTS DEFAULT_SECTOR_STARTING_REVENUE (1M ₳/day) of capacity
 * for free — an effective founding price of ~0.033 × the standing capacity
 * price, since that much capacity costs
 * `DEFAULT_SECTOR_STARTING_REVENUE × GROWTH_COST_MULTIPLIER` = 3M ₳ at the
 * 1953 anchor (the RPU terms cancel; see `capacityEconomy.test.ts`).
 *
 * Charging the standing price for a founding build would therefore be a ~30×
 * increase in the cost of entering a market, which would close the game to new
 * corps. This constant is the honest lever: the founding build is priced at
 * 0.1 × the standing price (300k ₳ for the starter capacity), a ~3× increase on
 * today's effective cost rather than a 30× one, and comfortably inside the
 * founding affordability gate (≤ 350k ₳, payback ≤ 30 financial days) that
 * `capacityEconomy.test.ts` pins.
 *
 * The alternative lever — bending the era price index — was rejected: the 1953
 * row is the calibration anchor and is 1.0 BY DEFINITION (identity B), so
 * moving it to make founding cheap would silently re-price every existing
 * growth-equivalent build as well. FLAGGED PROVISIONAL: worldsim re-tunes.
 *
 * Not wired into the founding flow in this phase — P3b owns that.
 */
export const CAPACITY_FOUNDING_DISCOUNT = 0.1;

/**
 * Share of the capacity taken off a defender that actually arrives at the
 * attacker, under plants (P3b — "attacks are a capacity transfer").
 *
 * Pre-plants an attack moved a ₳ revenue nameplate one-for-one: the defender
 * lost X ₳/day and the attacker gained X ₳/day. Under plants the thing being
 * fought over is physical: plants, contracts, staff and customer relationships
 * in one (state, sectorType). Taking them by force wrecks part of what you
 * take — sites are not transferred intact, crews leave, contracts lapse. So the
 * defender loses `capturedUnits` and the attacker receives only
 * `capturedUnits × ATTACK_CAPTURE_EFFICIENCY`; the remainder is DESTROYED, not
 * banked anywhere. That is deliberate: aggression should shrink the market it
 * is fought in, and it is what makes attacking a strategic choice rather than a
 * strictly cheaper substitute for building.
 *
 * FLAGGED PROVISIONAL: worldsim re-tunes.
 */
export const ATTACK_CAPTURE_EFFICIENCY = 0.6;

/**
 * How much dearer, PER UNIT ACTUALLY RECEIVED, an attack must be than simply
 * building the same capacity (plants only).
 *
 * The legacy attack price is a flat fraction of the defender's ₳ revenue
 * (`ATTACK_OWNED_COST_FRACTION`), which has no relationship at all to what
 * capacity costs. Priced against the build table it is far too cheap: the
 * legacy cost per unit received works out at roughly
 * `RPU / (efficiency × captureMultipliers × msShare)` ≈ 1.7-3.3 × RPU, while
 * building one unit costs `GROWTH_COST_MULTIPLIER × RPU × eraPriceIndex(year)`
 * = 3 × RPU at the 1953 anchor and 15 × RPU in the modern era. Left alone,
 * plants would make war on rivals the cheapest source of capacity in the game
 * by an order of magnitude, in every era after 1953.
 *
 * So under plants the attack price is floored at the build price of the
 * capacity the attacker actually receives, times this premium. Attacking is
 * then always the dearer way to acquire a plant (as it should be: you get it
 * NOW, you get it in a market you could not otherwise enter, and you take it
 * off a rival), and the destroyed `1 − ATTACK_CAPTURE_EFFICIENCY` share is real
 * damage on top rather than the only thing holding the price up.
 *
 * The floor is a `max` against the legacy cost, so it can never make an attack
 * CHEAPER than it is today.
 */
export const ATTACK_BUILD_PRICE_PREMIUM = 1.15;

/**
 * Largest single build order accepted, in capacity units. A sanity bound, not a
 * balance lever: it exists so a fat-fingered or hostile `units` value cannot
 * produce an absurd order or overflow downstream arithmetic. Affordability is
 * the real constraint.
 */
export const MAX_BUILD_UNITS_PER_ORDER = 10_000_000;

// ─── Host-country price level ───────────────────────────────────────────────

/**
 * WHY THE BUILD PRICE IS HOST-INDEXED.
 *
 * `capacityPricePerUnit` is a flat ₳ figure. Charged flat, a plant costs the
 * same to build in Lagos as in Zurich, which is both wrong and strategically
 * empty: siting is meant to be a real decision (cheap construction vs. rich
 * market vs. skilled workforce), and with a flat price there is nothing to
 * trade off. This multiplier is that lever.
 *
 * ─── SOURCE: the state's `costOfLiving` metric, NOT an exchange rate ────────
 * Choices considered:
 *
 *  1. `CountryConfig.usdExchangeRate` — REJECTED, and it is the trap. That field
 *     is not a price level and is not even an FX quote: it is the denomination
 *     normalizer that converts a seed file's authored GDP unit into ₳ (see
 *     `lib/currency/gdpAnchorRate.ts`, which says so at length — UK 2019 is 1.0
 *     while the market rate is 0.75). Indexing on it would price builds by which
 *     unit a seed file happened to be typed in.
 *  2. The live `exchangeRates` market — REJECTED, and this is the carry trade.
 *     Build costs are charged in ₳ (anchor). Multiplying an ₳ price by a NOMINAL
 *     exchange rate makes capacity structurally cheaper in ₳-real terms wherever
 *     a currency is weak, which is a pure arbitrage: incorporate in the weak
 *     host, build there, sell into the strong market. Any nominal-FX index has
 *     this property; that is why the index must be a REAL one.
 *  3. `monetaryEra` tables — REJECTED for this axis: they are an ERA dimension
 *     (which `capacityEraPriceIndex` already carries), not a cross-country one.
 *     Using them here would double-count time and say nothing about place.
 *  4. `economic.costOfLiving` — CHOSEN. It is the game's own 100-centered
 *     statement of "how expensive is it here", per state (so it also captures
 *     within-country variation, which is the right grain for a sited plant), it
 *     is denominated in nothing — it is an index, so it is immune to the
 *     currency arbitrage in (2) — and it already animates off urbanization and
 *     cabinet/housing policy. `expandSector` cost-adjusts by nothing at all
 *     today, so there is no existing precedent to match; this is the first one.
 *
 * HONEST LIMITATION: `costOfLiving` is a consumer basket, not a construction
 * cost index. It is a proxy — the right SHAPE (dense, rich, expensive places
 * cost more to build in) with an unvalidated magnitude. FLAGGED PROVISIONAL:
 * worldsim re-tunes the clamp band, and if construction ever gets its own metric
 * this function is the single place to repoint.
 */

/**
 * Clamp band on the host index. `costOfLiving` is bounded [40, 200] by its
 * registry node, which would be a 5× spread on build price — too wide for a
 * proxy this rough, and wide enough that a cabinet effect on cost-of-living
 * becomes a build-price exploit. The band keeps the lever meaningful and the
 * tail bounded. PROVISIONAL.
 */
export const HOST_BUILD_PRICE_INDEX_MIN = 0.6;
export const HOST_BUILD_PRICE_INDEX_MAX = 1.6;

/**
 * Host price-level multiplier on the build price, from the host state's
 * 100-centered `costOfLiving` index. 1.0 at the neutral 100 — and 1.0 when the
 * metric is absent, so a world with no metrics engine, a legacy state document,
 * or a test fixture prices exactly as it did before this factor existed.
 */
export function hostBuildPriceIndex(costOfLivingIndex: number | null | undefined): number {
  if (typeof costOfLivingIndex !== "number" || !Number.isFinite(costOfLivingIndex)) return 1;
  if (costOfLivingIndex <= 0) return 1;
  return Math.min(
    HOST_BUILD_PRICE_INDEX_MAX,
    Math.max(HOST_BUILD_PRICE_INDEX_MIN, costOfLivingIndex / 100)
  );
}

/** Inputs to {@link computeBuildCost}. */
export interface BuildCostInputs {
  sectorType: CorporationType;
  /** Capacity units ordered (output units/day). */
  units: number;
  /** World year — drives the era price column. */
  year: number;
  /**
   * The world's era unit-basis scale (`getEraUnitScale(preset)`). REQUIRED so
   * the compiler enumerates every pricing site: 1 for modern worlds, ~70 for
   * 1953, where it deflates the per-unit ₳ price to the era's money.
   */
  eraUnitScale: number;
  /** Sector's (state, type) market share %, for the dominance multiplier. */
  marketSharePercent?: number;
  /** Host country's prime rate (%), for the financing multiplier. */
  primeRate?: number;
  /** CEO Business Acumen; neutral when absent (NPP / vacant CEO). */
  acumen?: number;
  /** True for the founding build — applies {@link CAPACITY_FOUNDING_DISCOUNT}. */
  founding?: boolean;
  /**
   * Host state's 100-centered `costOfLiving` metric. Absent ⇒ neutral (1.0).
   * Resolved through {@link hostBuildPriceIndex}, which owns the clamp.
   */
  hostCostOfLivingIndex?: number | null;
  /**
   * The corp's aggregated tech growth-cost multiplier
   * (`AggregatedTechEffects.growthCostMultiplier`, already capped at
   * TECH_GROWTH_REDUCTION_CAP). Absent ⇒ 1 (no tech / tree disabled).
   */
  techGrowthCostMultiplier?: number;
}

/** Itemized build cost, so UI/tests/NPPs can show WHY a build costs what it does. */
export interface BuildCostBreakdown {
  /** Base ₳ per capacity unit at this year (era-indexed). */
  unitPriceAnchor: number;
  /** Dominance penalty multiplier (1 below the dominance threshold). */
  dominanceMultiplier: number;
  /** Prime-rate financing multiplier, acumen-dampened (1 at prime 0). */
  rateMultiplier: number;
  /** CEO Business Acumen flat discount multiplier (1 at neutral acumen). */
  acumenMultiplier: number;
  /** Tech-tree build-cost discount multiplier (1 with no tech / tree off). */
  techMultiplier: number;
  /** Host-country price-level multiplier (1 at a neutral cost of living). */
  hostPriceMultiplier: number;
  /** Founding discount multiplier (1 for an ordinary build). */
  foundingMultiplier: number;
  /** Total ₳ charged for the order. */
  totalAnchor: number;
}

/**
 * THE build price. One exported pure function so the command, the UI preview,
 * NPP behaviour and the tests can never disagree about what a build costs.
 *
 *     total = units × capacityPricePerUnit(type, year)
 *                   × dominanceMult(share)
 *                   × rateMult(primeRate, acumen)
 *                   × acumenMult(acumen)
 *                   × techMult(growthCostMultiplier)
 *                   × hostPriceMult(costOfLiving)
 *                   × foundingMult
 *
 * The situational multipliers are deliberately the SAME ones the legacy growth
 * path charges (`calculateDailyGrowthCost`): dominance
 * (`getDominanceGrowthCostMultiplier`), the acumen-dampened prime-rate term
 * `max(0.5, 1 + primeRate/10 × acumenRateSensitivity(acumen))`, the flat
 * `acumenGrowthCostMultiplier` discount, and the tech tree's capped
 * growth-cost reduction. Building capacity through the queue and buying it
 * through the growth slider must not price differently, or one of the two
 * becomes the only rational choice — and under plants the growth slider is
 * vestigial, so any modifier left wired only to growth cost is simply DEAD.
 * That is why acumen and the tech discount are re-homed here rather than
 * duplicated.
 *
 * ─── DOMINANCE IS TOLLED HERE, AND (UNDER PLANTS) ONLY HERE ─────────────────
 * Pre-plants, a dominant sector paid three separate dominance tolls: a margin
 * percentage-point penalty, a revenue tax (the "regulatory burden"), and this
 * growth/build-cost multiplier. That was defensible when growth was a slider
 * whose cost was small relative to revenue. Under plants it is not: capacity is
 * bought outright, so the build multiplier alone is a large, visible, up-front
 * charge, and stacking a permanent margin penalty and a permanent revenue tax on
 * top of it triple-charges the same condition and makes market leadership
 * strictly self-defeating.
 *
 * The plants design therefore consolidates: dominance is a BARRIER TO
 * EXPANSION, not a tax on operating. A dominant sector pays more to grow — a
 * price it can choose not to pay by not growing — and runs its existing plants
 * at an undistorted margin. `sectorTurn` gates the margin penalty and the
 * revenue tax off when plants is on; this multiplier is the whole toll.
 * (The dominance multiplier on the legacy growth-cost line is left alone: that
 * line is itself vestigial under plants and gating it would move the flip-turn
 * numbers for a dominant sector, which the flip identity forbids.)
 *
 * Note `capacityPricePerUnit` already carries GROWTH_COST_MULTIPLIER (identity
 * B), so the base term here is exactly the cash the growth path charges for the
 * same increment of capacity — no double-counting.
 */
export function computeBuildCost(inputs: BuildCostInputs): BuildCostBreakdown {
  const {
    sectorType,
    units,
    year,
    eraUnitScale,
    marketSharePercent = 0,
    primeRate = 0,
    acumen = NEUTRAL_STAT,
    founding = false,
    hostCostOfLivingIndex = null,
    techGrowthCostMultiplier = 1,
  } = inputs;
  const safeUnits = Number.isFinite(units) && units > 0 ? units : 0;
  const unitPriceAnchor = capacityPricePerUnit(sectorType, year, eraUnitScale);
  const dominanceMultiplier = getDominanceGrowthCostMultiplier(marketSharePercent);
  const rateMultiplier = Math.max(
    0.5,
    1 + ((Number.isFinite(primeRate) ? primeRate : 0) / 10) * acumenRateSensitivity(acumen)
  );
  // Acumen leg 2 of 2. `acumenRateSensitivity` above dampens the CEO's exposure
  // to prime rates; this is the flat discount `calculateDailyGrowthCost` also
  // applies. Under plants the growth path is vestigial, so without this the
  // Business Acumen stat's cost effect was half dead — it still softened rates
  // but its headline "growth is cheaper" clause bought nothing.
  const acumenMultiplier = acumenGrowthCostMultiplier(acumen);
  // Tech-tree `growthCostReduction` becomes a BUILD-price discount for the same
  // reason. The value handed in is already the capped aggregate
  // (1 − min(TECH_GROWTH_REDUCTION_CAP, Σ pct)), so the cap that applied to
  // growth cost applies here unchanged — no second, looser cap is introduced.
  // Clamped defensively to (0, 1] so a malformed caller cannot zero or invert a
  // build price.
  const techMultiplier =
    Number.isFinite(techGrowthCostMultiplier) &&
    techGrowthCostMultiplier > 0 &&
    techGrowthCostMultiplier <= 1
      ? techGrowthCostMultiplier
      : 1;
  const hostPriceMultiplier = hostBuildPriceIndex(hostCostOfLivingIndex);
  const foundingMultiplier = founding ? CAPACITY_FOUNDING_DISCOUNT : 1;
  return {
    unitPriceAnchor,
    dominanceMultiplier,
    rateMultiplier,
    acumenMultiplier,
    techMultiplier,
    hostPriceMultiplier,
    foundingMultiplier,
    totalAnchor:
      safeUnits *
      unitPriceAnchor *
      dominanceMultiplier *
      rateMultiplier *
      acumenMultiplier *
      techMultiplier *
      hostPriceMultiplier *
      foundingMultiplier,
  };
}
