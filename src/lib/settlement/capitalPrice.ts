/**
 * What a delegation play costs when paid for with political capital instead of
 * the national treasury.
 *
 * Derived from the play's MAGNITUDE, not converted from its funds cost. A
 * funds-to-capital exchange rate is not possible here: the authored funds costs
 * are denominated in four different currencies (ℳ30M, $60M, £25M), so one
 * global rate would be converting unlike things. Magnitude is the only
 * currency-free scale the four seats share.
 */
import {
  HUNDREDTHS,
  SETTLEMENT_CAPITAL_K,
  SETTLEMENT_TEMPO,
  type SettlementPlayDef,
} from "@/lib/constants/settlementCrisis";

/**
 * The authored mockup points behind a stored magnitude.
 *
 * `mag(points)` DIVIDES by `SETTLEMENT_TEMPO`; this multiplies it back out.
 * Deliberate, and the one place in the codebase that inverts `mag()`: funds
 * costs are literal figures that do not move with the tempo, so a capital price
 * derived from the tempo-scaled magnitude would shrink every time the speed
 * dial rose while the cash price it stands in for stood still, and the two
 * routes would drift apart on every tempo change.
 *
 * Lossy by one rounding step — `mag(2.5)` is 31, which recovers as 2.48 —
 * which {@link capitalPriceFor}'s own rounding absorbs.
 */
export function authoredPoints(magnitude: number): number {
  return (magnitude * SETTLEMENT_TEMPO) / HUNDREDTHS;
}

/**
 * The capital price of a play, ADDED to whatever capital it already costs, so
 * paying this way is never cheaper in capital than paying cash. The route buys
 * a delegation out of indebting the nation, not a discount.
 */
export function capitalPriceFor(play: SettlementPlayDef): number {
  return play.capitalCost + Math.round(authoredPoints(play.magnitude) * SETTLEMENT_CAPITAL_K);
}
