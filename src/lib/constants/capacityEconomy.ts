/**
 * In 1991 presets, plant investment prices capacity at one day of its nominal
 * output. Other presets retain the growth multiplier and era price column.
 * capacityPricePerUnit selects this basis. computeBuildCost applies host costs, borrowing rates,
 * CEO skill, technology and dominance; expanding existing plants gets a 20%
 * discount. Only the 1991 calibration omits the additional nominal price index. Idle capacity pays 30% upkeep and
 * mothballed capacity pays 5%.
 *
 * Capacity is output units per day. capacityUnitYield maps the commodity mix
 * to units per anchor currency; its inverse is revenuePerCapacityUnit. Both
 * conversions carry the same eraUnitScale. Prices follow the actual strategy,
 * preserving the value of cheap and expensive output baskets across retools.
 */

import { eraForPreset } from "@/lib/seeds/presetSelector";

import {
  COLD_CAPACITY_UPKEEP_FRACTION,
  constructionPriceForDailyRevenue,
  expansionCostMultiplier,
  investmentBuildTurns,
} from "@/lib/corporations/investment/rules";
import {
  CORPORATION_TYPES,
  GROWTH_COST_MULTIPLIER,
  acumenGrowthCostMultiplier,
  acumenRateSensitivity,
  dominanceDensityFactor,
  getDominanceGrowthCostMultiplier,
  getNationalDominanceGrowthCostMultiplier,
  type CorporationType,
  type MediaDiscriminator,
} from "./corporations";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import { COMMODITY_BASE_PRICES, type CommodityType } from "./commodities";
import {
  SECTOR_STRATEGIES,
  getStrategyForOperatingModel,
  getOperatingSectorType,
} from "./sectorStrategies";
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
  sectorType: CorporationType,
  industryModel?: string | null,
  mediaDiscriminator?: MediaDiscriminator | null
): Partial<Record<CommodityType, number>> {
  const operatingType = getOperatingSectorType(
    sectorType,
    industryModel,
    mediaDiscriminator
  ) as CorporationType;
  const strategies = SECTOR_STRATEGIES[operatingType] ?? [];
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
export function capacityUnitYield(
  sectorType: CorporationType,
  unitScale: number,
  industryModel?: string | null,
  mediaDiscriminator?: MediaDiscriminator | null
): number {
  const supply = defaultSupplyRates(sectorType, industryModel, mediaDiscriminator);
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
export function revenuePerCapacityUnit(
  sectorType: CorporationType,
  unitScale: number,
  industryModel?: string | null,
  mediaDiscriminator?: MediaDiscriminator | null
): number {
  const k = capacityUnitYield(sectorType, unitScale, industryModel, mediaDiscriminator);
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
  unitScale: number,
  industryModel?: string | null,
  mediaDiscriminator?: MediaDiscriminator | null
): number {
  const operatingType = getOperatingSectorType(
    sectorType,
    industryModel,
    mediaDiscriminator
  ) as CorporationType;
  if (!SECTOR_STRATEGIES[operatingType]?.length) return 0;
  const strategy = getStrategyForOperatingModel(
    sectorType,
    strategyId ?? DEFAULT_STRATEGY_ID,
    industryModel,
    mediaDiscriminator
  );
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
 * TRANSITION WINDOW: owned stock and paid orders use the destination basis.
 * The turn converts that stock into the blended recipe's physical units for
 * production, and converts produced units back before charging the held opex
 * anchor. Nameplate value stays constant through the blend; depreciation and
 * new construction still move owned stock in the usual way.
 *
 * Returns `capitalStock` unchanged when there is nothing meaningful to do (no
 * stock, a strategy with no priced output on either side, a non-finite input) —
 * a sector with no priced mix has no nameplate to keep invariant.
 */
export function rescaleCapacityForStrategyChange(
  capitalStock: number | null | undefined,
  sectorType: CorporationType,
  fromStrategyId: string | null | undefined,
  toStrategyId: string | null | undefined,
  industryModel?: string | null,
  mediaDiscriminator?: MediaDiscriminator | null
): number {
  const stock =
    typeof capitalStock === "number" && Number.isFinite(capitalStock) ? capitalStock : 0;
  if (stock <= 0) return stock;
  const ratio = capacityRescaleRatio(
    sectorType,
    fromStrategyId,
    toStrategyId,
    industryModel,
    mediaDiscriminator
  );
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
  toStrategyId: string | null | undefined,
  industryModel?: string | null,
  mediaDiscriminator?: MediaDiscriminator | null
): number {
  if ((fromStrategyId ?? DEFAULT_STRATEGY_ID) === (toStrategyId ?? DEFAULT_STRATEGY_ID)) return 1;
  // The era unit scale cancels in the from/to ratio, so this stays scale-free
  // by construction (passing the world's real scale would change nothing).
  const rpuFrom = revenuePerCapacityUnitForStrategy(
    sectorType,
    fromStrategyId,
    1,
    industryModel,
    mediaDiscriminator
  );
  const rpuTo = revenuePerCapacityUnitForStrategy(
    sectorType,
    toStrategyId,
    1,
    industryModel,
    mediaDiscriminator
  );
  if (!(rpuFrom > 0) || !(rpuTo > 0) || !Number.isFinite(rpuFrom / rpuTo)) return 1;
  return rpuFrom / rpuTo;
}

/**
 * Apply the retool rescale to a whole build queue, in place-free form.
 * `unitsOrdered` scales; everything else (paid cash, turn stamps) is untouched.
 *
 * `strategyId` is deliberately CARRIED THROUGH UNCHANGED by the spread. It
 * records the strategy an order was PRICED at, not the strategy the sector now
 * runs, and that is exactly what keeps the paid basis honest: an order bought
 * as coal stays recorded as coal while its `unitsOrdered` is divided down so
 * the nameplate it delivers is unchanged. Re-stamping it to the destination
 * strategy without also re-charging the order would assert the corp had paid
 * the rare-earth price when it had not.
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
const CAPACITY_ERA_PRICE_ANCHORS: ReadonlyArray<{ year: number; priceIndex: number }> = [
  { year: CAPACITY_ANCHOR_YEAR, priceIndex: 1.0 },
  { year: 1971, priceIndex: 1.4 },
  { year: 1979, priceIndex: 2.6 },
  { year: 1991, priceIndex: 3.6 },
  { year: MODERN_ERA_START_YEAR, priceIndex: 5.0 },
];

/** Modern calibration and missing-year fallback. PROVISIONAL. */
const CAPACITY_ERA_MODERN_PRICE_INDEX = 5.0;

/**
 * Interpolate nominal price levels geometrically between authored calibration
 * years. Equal year increments have equal proportional changes within a span,
 * preserving the anchors without imposing a price shock at an era boundary.
 * Outside the authored range, hold the nearest endpoint. Missing or invalid
 * years retain the modern fallback.
 */
export function capacityEraPriceIndex(year: number | null | undefined): number {
  if (typeof year !== "number" || !Number.isFinite(year)) {
    return CAPACITY_ERA_MODERN_PRICE_INDEX;
  }
  const first = CAPACITY_ERA_PRICE_ANCHORS[0];
  if (year <= first.year) return first.priceIndex;
  for (let i = 1; i < CAPACITY_ERA_PRICE_ANCHORS.length; i++) {
    const upper = CAPACITY_ERA_PRICE_ANCHORS[i];
    const lower = CAPACITY_ERA_PRICE_ANCHORS[i - 1];
    if (year <= upper.year) {
      const progress = (year - lower.year) / (upper.year - lower.year);
      return lower.priceIndex * Math.pow(upper.priceIndex / lower.priceIndex, progress);
    }
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
 * Undiscounted construction price per unit of daily capacity. The 1991 preset
 * uses one day of nominal output; all other presets retain the legacy growth
 * multiplier and price column. Without a preset, the year selects the basis.
 * Passing the originating preset keeps a 1991 world's price stable as it ages.
 */
export function capacityPricePerUnit(
  sectorType: CorporationType,
  year: number,
  unitScale: number,
  strategyId: string | null | undefined,
  industryModel?: string | null,
  mediaDiscriminator?: MediaDiscriminator | null,
  preset?: string
): number {
  const dailyRevenue = revenuePerCapacityUnitForStrategy(
    sectorType,
    strategyId,
    unitScale,
    industryModel,
    mediaDiscriminator
  );
  return uses1991Construction(year, preset)
    ? constructionPriceForDailyRevenue(dailyRevenue)
    : dailyRevenue * GROWTH_COST_MULTIPLIER * capacityEraPriceIndex(year);
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
  unitScale: number,
  industryModel?: string | null,
  mediaDiscriminator?: MediaDiscriminator | null
): number {
  // RPU carries the era unit scale in its denominator, so workers-per-unit
  // shrinks by the same factor unit counts grow — total staffing for a given
  // real capacity is era-invariant.
  return (
    (revenuePerCapacityUnit(sectorType, unitScale, industryModel, mediaDiscriminator) /
      CAPACITY_REVENUE_PER_WORKER) *
    capacityEraLaborIndex(year)
  );
}

// ─── Construction time ──────────────────────────────────────────────────────

/**
 * Authored base construction times, in turns. investmentBuildTurns applies
 * the ordinary heavy-build reduction while preserving founding durations.
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

/** Turns to complete a new build. Existing orders keep their stored window. */
export function CAPACITY_BUILD_TURNS(sectorType: CorporationType, founding = false): number {
  return investmentBuildTurns(
    CAPACITY_BUILD_TURNS_TABLE[sectorType] ?? CAPACITY_BUILD_TURNS_DEFAULT,
    founding
  );
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
 * Upkeep on parked capacity, as a fraction of its anchored maintenance basis.
 * A mothballed plant produces and offers nothing. Its owned capacity and paid
 * basis remain, with normal depreciation and reduced maintenance costs.
 */
export const MOTHBALL_UPKEEP_FRACTION = COLD_CAPACITY_UPKEEP_FRACTION;

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

/** Legacy first-plant discount. The qualified 1991 preset pays the full basis. */
export const CAPACITY_FOUNDING_DISCOUNT = 0.1;

function uses1991Construction(year: number, preset?: string): boolean {
  return preset == null ? year === 1991 : eraForPreset(preset) === "1991";
}

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
 * building one unit uses the preset's capacity-price basis and construction modifiers.
 * Any gap between the two prices can make cheap takeovers bypass construction.
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
  industryModel?: string | null;
  mediaDiscriminator?: MediaDiscriminator | null;
  /** Capacity units ordered (output units/day). */
  units: number;
  /**
   * The production method the capacity will run. REQUIRED (pass `null` for the
   * sector-type default) so the compiler enumerates every build-pricing site:
   * capacity is priced at the RPU of the product it will actually make, not the
   * type's default mix. See {@link capacityPricePerUnit} for why.
   */
  strategyId: string | null;
  /** World year for the legacy era price column. */
  year: number;
  /** Originating reset preset, so the calibration survives clock advancement. */
  preset?: string;
  /**
   * The world's era unit-basis scale (`getEraUnitScale(preset)`). REQUIRED so
   * the compiler enumerates every pricing site: 1 for modern worlds, ~70 for
   * 1953, where it deflates the per-unit ₳ price to the era's money.
   */
  eraUnitScale: number;
  /** Sector's (state, type) market share %, for the dominance multiplier. */
  marketSharePercent?: number;
  /**
   * Owning corporation's aggregate share of this (country, type) market.
   * The harsher of the local and national antitrust tolls prices the build.
   */
  nationalMarketSharePercent?: number;
  /**
   * Distinct RIVAL corporations holding a sector in the same (state, type) cell
   * — the building corp's own sectors excluded. Scales the dominance toll by
   * how contested the market is (see {@link dominanceDensityFactor}).
   *
   * Absent ⇒ treated as crowded (full toll). That is the safe default: a caller
   * that has not resolved density must not accidentally hand out a discount.
   */
  competitorCount?: number;
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
  /** Base anchor currency per capacity unit in the world's nominal unit basis. */
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
  /** Discount for ordinary expansion; founder pricing is unchanged. */
  expansionMultiplier: number;
  /** Total ₳ charged for the order. */
  totalAnchor: number;
}

/**
 * THE build price. One exported pure function so the command, the UI preview,
 * NPP behaviour and the tests can never disagree about what a build costs.
 *
 *     total = units × capacityPricePerUnit(type, year)
 *                   × max(localDominanceMult, nationalDominanceMult)
 *                     adjusted for competitorCount
 *                   × rateMult(primeRate, acumen)
 *                   × acumenMult(acumen)
 *                   × techMult(growthCostMultiplier)
 *                   × hostPriceMult(costOfLiving)
 *                   × foundingMult × expansionMult
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
 *
 * Because it IS the whole toll, it is also scaled by how contested the cell is
 * (`dominanceDensityFactor`, suggestion #30). 60% of a two-firm state and 60%
 * of a five-firm state are not the same achievement, and charging them alike
 * left thin markets unbuilt while demand went unserved. Density scales only the
 * toll's excess over 1.0, so a sub-threshold sector is unaffected at any
 * density and the price stays continuous in both share and rival count.
 * (The dominance multiplier on the legacy growth-cost line is left alone: that
 * line is itself vestigial under plants and gating it would move the flip-turn
 * numbers for a dominant sector, which the flip identity forbids.)
 *
 * `capacityPricePerUnit` selects the preset-qualified basis. The legacy growth
 * slider retains its separate pricing outside plants mode.
 */
export function computeBuildCost(inputs: BuildCostInputs): BuildCostBreakdown {
  const {
    sectorType,
    industryModel,
    mediaDiscriminator,
    units,
    strategyId,
    year,
    preset,
    eraUnitScale,
    marketSharePercent = 0,
    nationalMarketSharePercent = 0,
    competitorCount,
    primeRate = 0,
    acumen = NEUTRAL_STAT,
    founding = false,
    hostCostOfLivingIndex = null,
    techGrowthCostMultiplier = 1,
  } = inputs;
  const safeUnits = Number.isFinite(units) && units > 0 ? units : 0;
  const unitPriceAnchor = capacityPricePerUnit(
    sectorType,
    year,
    eraUnitScale,
    strategyId,
    industryModel,
    mediaDiscriminator,
    preset
  );
  // Dominance is scaled by how contested the cell is. The factor multiplies the
  // toll's EXCESS over 1.0, so a market with no rivals still pays a monopoly
  // premium, just a smaller one — and a sub-threshold sector (multiplier 1) is
  // untouched at any density.
  // Local and national dominance are alternative views of the same antitrust
  // condition, so take the harsher toll and density-adjust it once. Stacking
  // both would double-charge a corporation dominant at both grains.
  const localShare = Number.isFinite(marketSharePercent) ? marketSharePercent : 0;
  const nationalShare = Number.isFinite(nationalMarketSharePercent)
    ? nationalMarketSharePercent
    : 0;
  const rawDominance = Math.max(
    getDominanceGrowthCostMultiplier(localShare),
    getNationalDominanceGrowthCostMultiplier(nationalShare)
  );
  const dominanceMultiplier = 1 + (rawDominance - 1) * dominanceDensityFactor(competitorCount);
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
  const foundingMultiplier = founding
    ? uses1991Construction(year, preset)
      ? 1
      : CAPACITY_FOUNDING_DISCOUNT
    : 1;
  const expansionMultiplier = expansionCostMultiplier(founding);
  return {
    unitPriceAnchor,
    dominanceMultiplier,
    rateMultiplier,
    acumenMultiplier,
    techMultiplier,
    hostPriceMultiplier,
    foundingMultiplier,
    expansionMultiplier,
    totalAnchor:
      safeUnits *
      unitPriceAnchor *
      dominanceMultiplier *
      rateMultiplier *
      acumenMultiplier *
      techMultiplier *
      hostPriceMultiplier *
      foundingMultiplier *
      expansionMultiplier,
  };
}
