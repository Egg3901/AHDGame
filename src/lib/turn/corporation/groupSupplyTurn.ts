/** Group economic work is opt-in; disabled worlds perform no added group reads or forecast writes. */
import type { Db, AnyBulkWriteOperation } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { MarketContext } from "@/lib/market/marketContext";
import { resolveFormalizedGroups } from "@/lib/corporations/groups/groupMembership";
import type { CorporationLookups } from "./types";
export async function configureGroupSupply(
  db: Db,
  market: MarketContext,
  subsidiaries: boolean,
  enabled: boolean
) {
  market.groupSupplyEnabled = subsidiaries && market.plantsEnabled && enabled;
  return market.groupSupplyEnabled
    ? resolveFormalizedGroups(db, { includeReserved: true })
    : undefined;
}
export function groupForecastWriteOps(
  market: MarketContext,
  lookups: CorporationLookups
): AnyBulkWriteOperation<Corporation>[] {
  return [...(market.groupSupplyForecastByRoot ?? [])].flatMap(([id, basis]) => {
    const root = lookups.corpById.get(id);
    return root
      ? [
          {
            updateOne: { filter: { _id: root._id }, update: { $set: { groupSupplyBasis: basis } } },
          },
        ]
      : [];
  });
}
