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
 *   - `settlementPlays { crisisId, turn }` — the dossier's read of this turn's
 *     plays, which runs on every page view and every commit. The drain index
 *     above cannot serve it: `resolvedTurn` is the second field there, and this
 *     query filters on `turn`.
 *   - `settlementPlays { crisisId, turn, characterId, playId }` UNIQUE, partial
 *     on `actor: "personal"` — the backstop for the once-per-turn allowance.
 *     `commitPlay` counts a character's uses before inserting, and that read and
 *     that write are not atomic: two fast clicks both count zero and both
 *     insert, which is exactly the race the `settlementCrises { kind }` index
 *     below exists to close. PARTIAL because a DELEGATION may legitimately
 *     repeat a play in one turn if its action points allow, so the constraint
 *     must not reach seat rows.
 *
 *     ⚠️ A world that already holds duplicate personal rows — anything played
 *     before the allowance existed — will REJECT this index at creation.
 *     `ensureIndex` is tolerant and logs a `✗` rather than failing the seed, so
 *     the symptom is a quiet missing index, not a crash. The allowance still
 *     holds in that state, because `commitPlay` counts before inserting; only
 *     the double-click race is left open. Clear the duplicates and re-run this
 *     target to close it.
 *   - `settlementCrises { status }` — the open-crisis lookup. The collection
 *     holds a handful of documents at most, so this buys little today; it costs
 *     nothing and keeps the lookup honest if settlement crises ever run several
 *     at once, which the generic model deliberately allows for.
 *   - `settlementCrises { kind }` UNIQUE, partial on `status: "open"` — the
 *     guard that makes opening a crisis safe. Two overlapping turn runs both
 *     see "no open crisis" and both insert; without this the world ends up with
 *     two live German Questions and the phase ticks whichever it reads first.
 *     Partial so the resolved history is unconstrained — the question is
 *     designed to be asked again.
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
    "settlementPlays",
    { crisisId: 1, turn: 1 },
    { name: "settlementPlays_crisis_turn" },
    log
  );

  await ensureIndex(
    db,
    "settlementPlays",
    { crisisId: 1, turn: 1, characterId: 1, playId: 1 },
    {
      name: "settlementPlays_personal_once",
      unique: true,
      partialFilterExpression: { actor: "personal" },
    },
    log
  );

  await ensureIndex(
    db,
    "settlementCrises",
    { status: 1 },
    { name: "settlementCrises_status" },
    log
  );

  await ensureIndex(
    db,
    "settlementCrises",
    { kind: 1 },
    {
      name: "settlementCrises_open_unique",
      unique: true,
      partialFilterExpression: { status: "open" },
    },
    log
  );

  log("Settlement crisis indexes ensured");
}
