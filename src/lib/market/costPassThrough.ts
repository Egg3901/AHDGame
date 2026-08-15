/**
 * Producer cost pass-through for commodity price formation.
 *
 * Why this exists: commodity prices come from supply/demand pressure alone, so
 * a commodity could trade far below what it costs to make while the inputs to
 * make it trade far above base. Observed on prod (2026-08-15, ops-knowledge
 * ahd-corp-sector-npv-divergence): fertilizers at 2.26x base, plastics 1.60x,
 * freight 1.61x — while food, whose recipe spends 57% of nameplate revenue on
 * those inputs, sold at 0.58x into a glut. Result: 92 of 149 agriculture
 * sectors worldwide ran negative engine margins with no way to price their way
 * out, because nothing connected what a farm pays to what food sells for.
 *
 * The mechanism: each commodity's producing sector(s) have an input recipe
 * (SECTOR_DEMAND). The recipe's rate-weighted average of LAGGED price ratios is
 * the producer's input-cost index. When that index is above 1 (inputs dearer
 * than base), the commodity's effective base price is lifted by a damped share
 * of the excess before supply/demand pressure applies:
 *
 *     multiplier = min(CAP, 1 + BETA x (index - 1)),  floored at 1
 *
 * Deliberate properties:
 *  - FLOOR AT 1: cheap inputs never discount the price below what the
 *    supply/demand engine says — gluts still clear, only cost SQUEEZES are
 *    transmitted. Pass-through is a floor-lifter, not a price-setter.
 *  - LAGGED ratios (prior turn's prices) — the same one-turn lag the input
 *    bill itself uses, so there is no same-turn circularity.
 *  - BETA 0.5: producers eat half the squeeze, pass half. Chained recipes
 *    (chemicals -> plastics -> food) therefore converge geometrically instead
 *    of compounding, and the CAP bounds the worst case outright.
 *  - This also gives shortages a real remediation path: expensive inputs raise
 *    output prices, which raises producer margins, which attracts supply.
 */
import type { CommodityType } from "@/lib/constants/commodities";
import { SECTOR_DEMAND, SECTOR_SUPPLY } from "@/lib/constants/commodities";
import type { CorporationType } from "@/lib/constants/corporations";

/** Share of a producer's input-cost excess passed into its output price. */
export const COST_PASS_THROUGH_BETA = 0.5;
/** Hard ceiling on the pass-through multiplier. */
export const COST_PASS_THROUGH_CAP = 1.75;

/**
 * Rate-weighted average input price ratio for a sector type. 1 when the sector
 * has no recipe or every ratio is missing (missing ratio = at base = 1).
 */
export function sectorInputCostIndex(
  sectorType: CorporationType,
  priceRatios: ReadonlyMap<CommodityType, number>
): number {
  const recipe = SECTOR_DEMAND[sectorType];
  if (!recipe || recipe.length === 0) return 1;
  let weighted = 0;
  let totalRate = 0;
  for (const { commodity, rate } of recipe) {
    if (!(rate > 0)) continue;
    const ratio = priceRatios.get(commodity);
    weighted += rate * (Number.isFinite(ratio) && (ratio as number) > 0 ? (ratio as number) : 1);
    totalRate += rate;
  }
  return totalRate > 0 ? weighted / totalRate : 1;
}

/** commodity -> its producing sector types, weighted by output rate. */
const PRODUCERS_BY_COMMODITY: ReadonlyMap<
  CommodityType,
  { sectorType: CorporationType; weight: number }[]
> = (() => {
  const map = new Map<CommodityType, { sectorType: CorporationType; weight: number }[]>();
  for (const [sectorType, outputs] of Object.entries(SECTOR_SUPPLY)) {
    for (const { commodity, rate } of outputs ?? []) {
      if (!(rate > 0)) continue;
      const list = map.get(commodity) ?? [];
      list.push({ sectorType: sectorType as CorporationType, weight: rate });
      map.set(commodity, list);
    }
  }
  return map;
})();

/**
 * The pass-through multiplier for one commodity given lagged price ratios.
 * >= 1 always; 1 for commodities nothing produces (pure-extraction resources
 * keep their existing pricing untouched).
 */
export function costPassThroughMultiplier(
  commodity: CommodityType,
  priceRatios: ReadonlyMap<CommodityType, number>
): number {
  const producers = PRODUCERS_BY_COMMODITY.get(commodity);
  if (!producers || producers.length === 0) return 1;
  let weighted = 0;
  let totalWeight = 0;
  for (const { sectorType, weight } of producers) {
    weighted += weight * sectorInputCostIndex(sectorType, priceRatios);
    totalWeight += weight;
  }
  const index = totalWeight > 0 ? weighted / totalWeight : 1;
  if (!(index > 1)) return 1;
  return Math.min(COST_PASS_THROUGH_CAP, 1 + COST_PASS_THROUGH_BETA * (index - 1));
}
