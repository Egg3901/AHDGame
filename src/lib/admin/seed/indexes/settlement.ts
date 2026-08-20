import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for the settlement-crisis collections.
 *
 * The sibling alignment collections carry no indexes, and for them that is
 * fine — only a handful of superpower organisations ever queue an influence
 * play. `settlementPlays` is a different shape of collection: every character
 * in the world holds a personal play, so a busy turn writes on the order of a
 * thousand rows and an iteration accumulates hundreds of thousands. The turn
 * phase drains it every single tick on `{ crisisId, resolvedTurn: null }`, so
 * without a matching compound index that drain degrades into a full scan of the
 * whole iteration's history once a turn.
 *
 *   - `settlementPlays { crisisId, resolvedTurn }` — the drain query, in that
 *     field order: equality on `crisisId` first, then the `null` match on
 *     `resolvedTurn`. Also serves the per-crisis audit read a player's "what did
 *     my money buy" view will need.
 *   - `settlementCrises { status }` — the open-crisis lookup. The collection
 *     holds a handful of documents at most, so this buys little today; it costs
 *     nothing and keeps the lookup honest if settlement crises ever run several
 *     at once, which the generic model deliberately allows for.
 */
export async function seedSettlementIndexes(db: Db, log: (msg: string) => void) {
  log("Settlement crisis indexes:");

  await ensureIndex(
    db,
    "settlementPlays",
    { crisisId: 1, resolvedTurn: 1 },
    { name: "settlementPlays_crisis_resolved" },
    log
  );

  await ensureIndex(
    db,
    "settlementCrises",
    { status: 1 },
    { name: "settlementCrises_status" },
    log
  );

  log("Settlement crisis indexes ensured");
}
