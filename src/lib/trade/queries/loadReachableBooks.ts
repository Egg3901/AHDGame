import type { Db } from "mongodb";
import type { CommodityType } from "@/lib/constants/commodities";
import type { TradeFlowSnapshot } from "@/lib/db/types/tradeFlowSnapshot";
import type { ReachableBookEntry, ReachableBooksDoc } from "@/lib/trade/reachableBook";

/**
 * Load the latest turn's reachable books (ticket #1077).
 *
 * Returns `null` when no snapshot carries them: worlds that have not run a turn
 * since 1.1.2 shipped, and any world below the trade-clearing tier. Callers MUST
 * treat null as "fall back to the previous global-aggregate behaviour" rather
 * than as "no room", or a world mid-upgrade would show every market closed.
 */
export async function loadReachableBooks(db: Db): Promise<ReachableBooksDoc | null> {
  const doc = await db
    .collection<TradeFlowSnapshot>("tradeFlowSnapshots")
    .findOne({ books: { $exists: true } }, { sort: { turn: -1 }, projection: { books: 1 } });
  return doc?.books ?? null;
}

/** One country's book for one commodity, or undefined when absent. */
export function bookFor(
  books: ReachableBooksDoc | null,
  countryId: string,
  commodity: CommodityType
): ReachableBookEntry | undefined {
  return books?.[countryId]?.[commodity];
}
