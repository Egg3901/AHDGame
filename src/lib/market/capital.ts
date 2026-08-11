import type { CommodityType } from "@/lib/constants/commodities";
import { safeUnitScale } from "@/lib/constants/capacityEconomy";

/**
 * Capital tier — Fix 4 v1 of the structural market rework
 * (marketSystemMode >= "capital", audit t806; see
 * docs/plans/2026-07-03-market-structural-plan.md).
 *
 * Sectors own productive **capacity** (output units/day) that depreciates
 * every turn. The growth slider stops being a pure revenue mint and becomes
 * **investment**: it builds capacity, and a sector that stops investing
 * slowly loses the ability to produce. Realized output is gated by capacity
 * exactly the way geological capacity gates extraction — output above what
 * your capital can make is not realized as revenue.
 */

/**
 * Seed headroom: capacity starts 10% above implied output so flipping the
 * mode on is a no-op (utilization begins < 1 capacity-side, factor = 1) and
 * depreciation only starts to bite sectors that stop investing.
 */
export const CAPITAL_SEED_HEADROOM = 1.1;

/** Capacity lost per turn with zero investment (~12% over 5 game years). */
export const CAPITAL_DEPRECIATION_PER_TURN = 0.0005;

/**
 * Launch-safety governor for the clearing/capital revenue leg.
 *
 * Big corps run on thin net margins (~0.5% of revenue), so even a few-percent
 * gap between what clearing/capital realizes and what the prior ledger mode
 * (priceRealization) realized is leveraged into a 50-80% earnings swing — a
 * flip that would visibly "nuke" the largest, most visible companies. This
 * governor (a) bounds the clearing/capital realized factor to within ±CAP of
 * the ledger baseline so the per-turn earnings swing stays small, and (b) ramps
 * that bounded divergence in from zero over RAMP_TURNS so the mode flip itself
 * is a no-op (day 1: realized == ledger exactly) and divergence only accrues
 * gradually. Widen CAP / shorten RAMP later once the flip is proven stable.
 */
export const MARKET_REALIZATION_DEVIATION_CAP = 0.15;
export const MARKET_REALIZATION_RAMP_TURNS = 240;

/**
 * Capital book anchor — a depreciated high-water mark on a sector's going-concern
 * value (sectorNPV), used as a tangible-book floor under capital mode.
 *
 * Under capital, a sector converts current earnings into productive `capitalStock`
 * (a real asset), but tangible book only credits sectorNPV — a perpetuity on
 * *current* profit that collapses when profit is transiently depressed during the
 * transition, valuing a corp that owns real capacity as if it owns nothing. The
 * anchor is seeded at the current NPV on first exposure (so the flip is a no-op),
 * ratchets UP with NPV, and decays only slowly (per-turn depreciation) when NPV
 * falls — so valuation reflects durable owned capacity through a profit dip
 * without ever exceeding the sector's own historical peak (no over-crediting).
 * A permanently-impaired sector still bleeds down as the anchor decays.
 */
export function advanceCapitalBookAnchor(args: {
  prevAnchor: number | null | undefined;
  sectorNPV: number;
  depreciationPerTurn?: number;
}): number {
  const { prevAnchor, sectorNPV, depreciationPerTurn = CAPITAL_DEPRECIATION_PER_TURN } = args;
  const npv = Number.isFinite(sectorNPV) && sectorNPV > 0 ? sectorNPV : 0;
  // First exposure: seed at the current NPV → floor is a no-op on the flip turn.
  if (!(typeof prevAnchor === "number" && prevAnchor > 0)) return npv;
  const decayed = prevAnchor * (1 - Math.max(0, depreciationPerTurn));
  return Math.max(npv, decayed);
}

/**
 * The deviation cap WIDENS as the ramp completes, and is released entirely at
 * full ramp.
 *
 * A fixed ±CAP was a launch-safety device that never turned itself off: with a
 * constant 0.15 the governor floors a fully-halted plant at 85% of its
 * nameplate revenue for ever, which makes the whole physical layer (capacity,
 * production, sales) cosmetic beyond ±15% no matter how long the world has run.
 * The ramp λ already fades the governor in; the cap has to fade out with it.
 *
 *   capEffective(λ) = λ >= 1 ? ∞ : cap / (1 − λ)
 *
 * Properties, all deliberate:
 *   - λ = 0 (flip turn): the blend returns the baseline verbatim regardless, so
 *     flip-day identity is preserved exactly (1e-6 suite).
 *   - λ = 0.5 (half ramp): the bound on the BLENDED deviation is
 *     λ · capEffective = cap — i.e. the mid-ramp world is exactly as tightly
 *     governed as the old constant-cap world was.
 *   - λ < 0.5: the blended deviation bound is below `cap` (tighter than before).
 *   - λ = 1 (fully ramped): unbounded → the governor is inert and the physical
 *     result stands on its own.
 */
export function governorEffectiveCap(cap: number, lambda: number): number {
  if (!(lambda < 1)) return Number.POSITIVE_INFINITY;
  return cap / (1 - lambda);
}

/** Shared blend used by both the factor and the amount variants. */
function governorBlend(
  baseline: number,
  market: number,
  startTurn: number | null | undefined,
  currentTurn: number | null | undefined,
  cap: number,
  rampTurns: number
): number {
  const c = Number.isFinite(cap) && cap >= 0 ? cap : MARKET_REALIZATION_DEVIATION_CAP;
  const ramp =
    Number.isFinite(rampTurns) && rampTurns >= 1 ? rampTurns : MARKET_REALIZATION_RAMP_TURNS;
  const now = currentTurn ?? 0;
  const since = Math.max(0, now - (startTurn ?? now));
  const lambda = Math.min(1, since / ramp);
  const ce = governorEffectiveCap(c, lambda);
  // At λ = 1 the bounds are ±∞, so `capped` is `market` exactly — no NaN, since
  // `baseline` is finite and positive by the callers' own guards.
  const capped = Math.min(baseline * (1 + ce), Math.max(baseline * (1 - ce), market));
  return baseline + lambda * (capped - baseline);
}

/**
 * Blend a clearing/capital revenue FACTOR toward the ledger baseline factor it
 * replaces: clamp it to ±capEffective(λ) of the baseline, then ramp that clamped
 * deviation in from 0 over RAMP_TURNS (λ = 0 at the flip turn → returns the
 * baseline exactly → no-op). Returns the baseline unchanged for degenerate
 * inputs — for a FACTOR, a non-positive input is garbage, not "zero output".
 *
 * Do NOT call this with revenue amounts: see `softenedMarketRealizationAmount`.
 */
export function softenedMarketRealization(
  ledgerFactor: number,
  marketFactor: number,
  startTurn: number | null | undefined,
  currentTurn: number | null | undefined,
  cap: number = MARKET_REALIZATION_DEVIATION_CAP,
  rampTurns: number = MARKET_REALIZATION_RAMP_TURNS
): number {
  const lf = Number.isFinite(ledgerFactor) && ledgerFactor > 0 ? ledgerFactor : 1;
  const mf = Number.isFinite(marketFactor) && marketFactor > 0 ? marketFactor : lf;
  return governorBlend(lf, mf, startTurn, currentTurn, cap, rampTurns);
}

/**
 * Same governor, applied to a revenue AMOUNT rather than a factor.
 *
 * The difference is the whole point of the split: for a factor, `<= 0` means
 * "no signal, use the baseline". For an amount, `0` is a perfectly meaningful
 * value — a halted, unstaffed or output-less plant earns nothing. Routing
 * amounts through the factor variant paid a fully-halted sector its entire
 * baseline revenue with none of the costs (a ~6x profit pump), and made the
 * boundary discontinuous: one epsilon of production earned 85% of nameplate
 * while exactly zero production earned 100%.
 *
 * Here `market <= 0` is taken literally and blended like any other amount, so
 * the halt is continuous and, at full ramp (cap released), lands on exactly 0.
 * A non-positive BASELINE still has no anchor to govern against, so the market
 * amount passes through unchanged. The result is floored at 0 — the governor
 * must never mint negative revenue.
 */
export function softenedMarketRealizationAmount(
  baselineAmount: number,
  marketAmount: number,
  startTurn: number | null | undefined,
  currentTurn: number | null | undefined,
  cap: number = MARKET_REALIZATION_DEVIATION_CAP,
  rampTurns: number = MARKET_REALIZATION_RAMP_TURNS
): number {
  const ma = Number.isFinite(marketAmount) && marketAmount > 0 ? marketAmount : 0;
  if (!(Number.isFinite(baselineAmount) && baselineAmount > 0)) return ma;
  return Math.max(0, governorBlend(baselineAmount, ma, startTurn, currentTurn, cap, rampTurns));
}

/**
 * Output the sector's revenue base implies at full throughput:
 * Σ revenue × rate / basePrice over its output mix, × the world's era unit
 * scale.
 *
 * `unitScale` (`getEraUnitScale(preset)`) is REQUIRED: the base-price table is
 * 2019-calibrated, and a pre-modern world's revenue is era-nominal, so without
 * the scale a 1953 economy implies ~70x too few units. It is 1 for every
 * modern world, so modern behavior is byte-identical.
 */
export function impliedOutputUnits(
  revenue: number,
  supplyRates: Partial<Record<CommodityType, number>>,
  basePrices: Record<CommodityType, number>,
  unitScale: number
): number {
  if (!Number.isFinite(revenue) || revenue <= 0 || !supplyRates) return 0;
  let units = 0;
  for (const commodity of Object.keys(supplyRates) as CommodityType[]) {
    const rate = supplyRates[commodity] ?? 0;
    const base = basePrices[commodity];
    if (rate <= 0 || !(base > 0)) continue;
    units += (revenue * rate) / base;
  }
  return units * safeUnitScale(unitScale);
}

/** Initial capacity at first exposure: implied output × headroom. */
export function seedCapitalStock(
  revenue: number,
  supplyRates: Partial<Record<CommodityType, number>>,
  basePrices: Record<CommodityType, number>,
  unitScale: number
): number {
  return impliedOutputUnits(revenue, supplyRates, basePrices, unitScale) * CAPITAL_SEED_HEADROOM;
}

/**
 * Advance capacity one turn: investment (the growth slider, %/turn) builds
 * it, depreciation erodes it. Floored at 0; garbage stock reads as 0.
 */
export function advanceCapitalStock(args: {
  prevStock: number;
  currentGrowthRate: number;
}): number {
  const { prevStock, currentGrowthRate } = args;
  const safePrev = Number.isFinite(prevStock) && prevStock > 0 ? prevStock : 0;
  const growth = Number.isFinite(currentGrowthRate) ? currentGrowthRate / 100 : 0;
  return Math.max(0, safePrev * (1 + growth - CAPITAL_DEPRECIATION_PER_TURN));
}

/**
 * Output-gating factor: min(1, capacity / implied output). 1 when there is
 * nothing to produce; 0 when capacity is gone and output was expected.
 */
export function capitalUtilizationFactor(stock: number, impliedUnits: number): number {
  if (!(impliedUnits > 0)) return 1;
  const safeStock = Number.isFinite(stock) && stock > 0 ? stock : 0;
  return Math.min(1, safeStock / impliedUnits);
}
