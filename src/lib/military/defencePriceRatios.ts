import type { Db } from "mongodb";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";

/**
 * Live commodity price ratios for defence lot costing.
 *
 * `lotProductionCost` has always accepted a ratio map and always been called without one, so
 * every contract was costed at the recipe's NOMINAL input share: the price floor and the
 * minister's price band did not move when steel did. That made the floor a constant dressed up
 * as a cost, and it meant a supplier could be held to a price struck in a cheap market long
 * after the market stopped being cheap.
 *
 * Same source and same shape the corporation turn's `priceRatioByCommodity` uses
 * (`globalPrice / basePrice` off the `commodityPrices` collection), so a lot's cost floor and a
 * plant's actual input bill move together instead of being two numbers that happen to agree on
 * the day they were written.
 *
 * Deliberately the WORLD ratio, not a country's reachable ratio. The reachable overlay exists
 * because a plant buys in its own market, and using it here would be more precise - but it is
 * per country per commodity and the award form is a client component that quotes a band before
 * any of that is in scope. A world ratio is the same number for both ends of the negotiation,
 * which is the property a price band needs most.
 */
export type CommodityPriceRatios = ReadonlyMap<CommodityType, number>;

/** Ratios that leave every recipe at its nominal share, for a world with no price book yet. */
export const NOMINAL_PRICE_RATIOS: CommodityPriceRatios = new Map();

/**
 * Build the ratio map from the live price book.
 *
 * A commodity is skipped rather than defaulted when either side of the ratio is unusable, so a
 * half-seeded book yields a partial map and the missing entries fall back to ratio 1 inside
 * `lotInputCost`. Returning a zero for a missing price would cost the lot at nothing and put
 * the floor on the floor, which is the one failure mode the band exists to prevent.
 */
export function priceRatiosFrom(prices: readonly CommodityPrice[]): CommodityPriceRatios {
  const out = new Map<CommodityType, number>();
  for (const p of prices) {
    const base = COMMODITY_BASE_PRICES[p.commodity];
    if (!(base > 0)) continue;
    if (typeof p.globalPrice !== "number" || !Number.isFinite(p.globalPrice) || p.globalPrice <= 0)
      continue;
    out.set(p.commodity, p.globalPrice / base);
  }
  return out;
}

/**
 * One projected read of the price book, for callers that price a lot.
 *
 * Cheap enough to do per request on the award path and ONCE per delivery sweep. Never cached at
 * module scope: a stale ratio would survive a world reset into the next era, which is exactly
 * the class of bug the anchor-rate module was written to remove.
 */
export async function loadDefencePriceRatios(db: Db): Promise<CommodityPriceRatios> {
  const prices = await db
    .collection<CommodityPrice>("commodityPrices")
    .find({}, { projection: { commodity: 1, globalPrice: 1 } })
    .toArray();
  return priceRatiosFrom(prices);
}
