/**
 * NPP engine 6: opportunity-driven investing (v6).
 *
 * Below v6 every NPP with spare investment cash rolls a flat chance to buy
 * (stock 0.075, bond 0.05, times risk tolerance) before it looks at the
 * market, and every NPP holding a share position rolls 0.02 times its price
 * ratio to trim it. Whether the market is cheap or dear only decides WHAT gets
 * bought, never WHETHER anything is.
 *
 * At v6 an NPP looks first and acts on what it sees. Each NPP's chance scales
 * with the quality of its best available opportunity:
 *   - stock buy: the best fundamental-to-price ratio on offer, relative to the
 *     least this NPP will accept (its value floor);
 *   - bond buy: the best current yield, relative to the yield floor;
 *   - stock sell: how far the holding trades above fundamentals.
 *
 * Smarter, not stronger. The multipliers are normalized across everyone
 * deciding in the same sweep so the expected number of trades equals what the
 * flat engine 5 rates give on the same candidate set: a clearly better
 * opportunity raises an NPP's chance, a marginal one lowers it, and the total
 * does not move. Each multiplier is capped (2x base for buys, the engine 5
 * price-ratio ceiling for sells), so no single NPP trades far more often than
 * before. Size rules are unchanged.
 *
 * Pure: the caller loads the market, draws from its seeded streams and writes.
 */

/** Ceiling on a buy multiplier: at most twice the engine 5 chance. */
export const OPPORTUNITY_BUY_CAP = 2;
/**
 * Ceiling on a sell multiplier. Engine 5 clamps its price ratio to 2.5, so the
 * highest per-holding sell chance is unchanged.
 */
export const OPPORTUNITY_SELL_CAP = 2.5;
/** Contrast of the stock value edge: a 20% better edge weighs 1.44x. */
export const STOCK_EDGE_EXPONENT = 2;
/** Bond yields spread wider than value ratios, so the edge is damped. */
export const BOND_EDGE_EXPONENT = 0.5;
/** Contrast of the sell signal: 1.2x fundamentals weighs 1.73x, 0.8x weighs 0.51x. */
export const SELL_EDGE_EXPONENT = 3;

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Stock buy opportunity: the best value ratio (fundamental / price) on offer
 * over this NPP's minimum acceptable ratio, sharpened. 1 at the floor.
 */
export function stockBuyOpportunity(bestValueRatio: number, minValueRatio: number): number {
  const best = finitePositive(bestValueRatio);
  const floor = finitePositive(minValueRatio);
  if (best === 0 || floor === 0) return 0;
  return Math.pow(best / floor, STOCK_EDGE_EXPONENT);
}

/** Bond buy opportunity: the best current yield over the yield floor, damped. */
export function bondBuyOpportunity(bestYieldPct: number, minYieldPct: number): number {
  const best = finitePositive(bestYieldPct);
  const floor = finitePositive(minYieldPct);
  if (best === 0 || floor === 0) return 0;
  return Math.pow(best / floor, BOND_EDGE_EXPONENT);
}

/** Stock sell opportunity: price over fundamentals (already clamped by the caller), sharpened. */
export function stockSellOpportunity(priceRatio: number): number {
  return Math.pow(finitePositive(priceRatio), SELL_EDGE_EXPONENT);
}

/**
 * Multipliers m_i, each in [0, cap], proportional to `scores[i]` below the
 * cap, chosen so that sum(baseProbabilities[i] * m_i) equals `targetExpected`.
 *
 * `baseProbabilities[i] * m_i` is decider i's chance to act, so the left side
 * is the expected number of trades. Callers pass the engine 5 expectation as
 * the target, which is what holds volume in place.
 *
 * Water-filling: scale every uncapped score by one factor, pin anything that
 * exceeds the cap, and repeat on the rest. It ends in at most n passes. If the
 * target is unreachable (it needs more than `cap` everywhere) every decider
 * gets the cap. With no usable score at all it returns 1 everywhere, which is
 * the engine 5 flat rate.
 */
export function volumeNormalizedMultipliers(
  scores: readonly number[],
  baseProbabilities: readonly number[],
  targetExpected: number,
  cap: number
): number[] {
  const n = scores.length;
  const s = scores.map(finitePositive);
  const p = baseProbabilities.map(finitePositive);
  const target = finitePositive(targetExpected);
  const weighted = s.reduce((sum, score, i) => sum + score * p[i], 0);
  if (n === 0) return [];
  if (weighted === 0) return new Array<number>(n).fill(1);

  const capped = new Array<boolean>(n).fill(false);
  let factor = 0;
  for (let pass = 0; pass <= n; pass++) {
    let cappedMass = 0;
    let freeMass = 0;
    for (let i = 0; i < n; i++) {
      if (capped[i]) cappedMass += cap * p[i];
      else freeMass += s[i] * p[i];
    }
    if (freeMass === 0) break;
    factor = Math.max(0, (target - cappedMass) / freeMass);
    let pinned = false;
    for (let i = 0; i < n; i++) {
      if (!capped[i] && factor * s[i] > cap) {
        capped[i] = true;
        pinned = true;
      }
    }
    if (!pinned) break;
  }
  return s.map((score, i) => (capped[i] ? cap : Math.min(cap, factor * score)));
}
