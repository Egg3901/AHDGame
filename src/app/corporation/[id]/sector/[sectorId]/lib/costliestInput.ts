import type { CommodityFlow } from "../types";

/**
 * The input that costs this sector the most per turn: units bought times the
 * price actually billed. Ties and zero-cost rows resolve to nothing, so a
 * sector with no priced input offers no discovery prompt.
 */
export function costliestInput(demands: readonly CommodityFlow[]): CommodityFlow | null {
  let best: CommodityFlow | null = null;
  let bestCost = 0;
  for (const flow of demands) {
    const cost = flow.units * (flow.billedUnitPrice ?? flow.marketPrice);
    if (Number.isFinite(cost) && cost > bestCost) {
      best = flow;
      bestCost = cost;
    }
  }
  return best;
}
