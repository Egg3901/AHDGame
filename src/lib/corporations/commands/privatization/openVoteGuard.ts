import type { Db, ObjectId } from "mongodb";
import type { Corporation, CorporationPrivatizationVote } from "@/lib/db/types";

/**
 * Returns true if there is currently an open privatization vote for this corp.
 * Used by share-trading and cap-table-mutation routes to block actions while a
 * vote is in progress (anti-gaming).
 */
export async function hasOpenPrivatizationVote(db: Db, corporationId: ObjectId): Promise<boolean> {
  const vote = await db
    .collection<CorporationPrivatizationVote>("corporationPrivatizationVotes")
    .findOne({ corporationId, status: "open" }, { projection: { _id: 1 } });
  return vote !== null;
}

/**
 * CEO-trade guard: blocks share trades on `corp` when the trader is the CEO
 * AND a privatization vote is open. Returns null when the action may proceed,
 * or an error envelope to short-circuit the route. Public/non-CEO traders are
 * never blocked — the price is locked and the worst-case cash already reserved,
 * so other parties moving shares around doesn't break the buyout invariants.
 */
export async function assertCeoTradeNotBlocked(
  db: Db,
  corp: Pick<Corporation, "_id" | "ceoId">,
  traderCharacterId: ObjectId
): Promise<{ blocked: false } | { blocked: true; error: string; status: number }> {
  // Defensive: corp.ceoId is non-null in the schema but legacy/test mocks may
  // omit it. If the corp has no CEO recorded, no one can be the CEO trader, so
  // skip the lock entirely.
  if (!corp.ceoId) return { blocked: false };
  if (traderCharacterId.toString() !== corp.ceoId.toString()) {
    return { blocked: false };
  }
  if (!(await hasOpenPrivatizationVote(db, corp._id))) {
    return { blocked: false };
  }
  return {
    blocked: true,
    error: "CEO cannot trade their own shares while a privatization vote is open",
    status: 400,
  };
}
