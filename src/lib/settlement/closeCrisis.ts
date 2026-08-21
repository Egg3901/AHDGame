/**
 * Closing the German Question without deciding it.
 *
 * The counterpart to `openSettlementCrisis`: an admin started the question, and
 * an admin can call it off. "As if it never started" means the WORLD is not
 * changed by it — no winner, no absorption, no country-history entry, no
 * cooldown, nothing for the actuation sweep to enact. The next tick simply
 * finds nothing live.
 *
 * WHY A STATUS AND NOT A DELETE. Deleting would strand every `settlementPlay`
 * row pointing at a crisis that no longer exists, and those rows are the record
 * of money and actions players really spent. `cancelled` is terminal and inert
 * instead: every sweep and read in the feature filters positively on `open`,
 * `frozen` or `resolved`, so nothing picks a cancelled document up. The unique
 * partial index is on `status: "open"` too, so a cancelled crisis does not block
 * the next one — the question can be reopened on the same turn it was closed.
 *
 * WHAT THIS DOES NOT DO: refund. Plays that already resolved spent real treasury
 * and real character funds, turn by turn, at the rates of the day. Unwinding
 * that is a different and much larger operation than closing a crisis, and
 * doing it silently here would be worse than not doing it. Money spent stays
 * spent; the crisis simply stops.
 *
 * A FROZEN crisis can be closed too, but the war it declared is a real conflict
 * on the Conflicts board and is NOT cancelled by this. That is deliberate — a
 * war with its own combatants, occupations and history is not this feature's to
 * silently erase. Cancelling here does stop the conflict's result from ever
 * settling the question, because `settleFrozenCrisisFromConflict` only sweeps
 * `status: "frozen"`.
 */
import type { Db, Filter } from "mongodb";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";

export interface CloseCrisisResult {
  closed: boolean;
  /** Why it did not close. Null on success. */
  reason: string | null;
  /** Set when the crisis had already declared a war that outlives it. */
  orphanedConflictId: string | null;
}

export async function closeSettlementCrisis(
  db: Db,
  params: { turn: number }
): Promise<CloseCrisisResult> {
  const { turn } = params;
  const crises = await getSettlementCrisesCollection(db);

  const live = await crises.findOne({
    status: { $in: ["open", "frozen"] },
  } as Filter<SettlementCrisisDoc>);
  if (!live) {
    return { closed: false, reason: "No settlement crisis is live.", orphanedConflictId: null };
  }

  // Guarded on the status it was read at, so a tick that resolved the crisis
  // between the read and the write wins instead of being silently discarded —
  // a decided question must not be cancelled out from under its own outcome.
  const claimed = await crises.updateOne(
    { _id: live._id, status: live.status } as Filter<SettlementCrisisDoc>,
    {
      $set: {
        status: "cancelled",
        // Explicitly null: no side won. `resolvedTurn` records only that it
        // left play, which is why `outcome` is the field that says how.
        outcome: null,
        resolvedTurn: turn,
        cooldownUntilTurn: null,
        updatedAt: new Date(),
      },
    }
  );
  if (claimed.matchedCount !== 1) {
    return {
      closed: false,
      reason: "The crisis changed state before this landed. Reload and look again.",
      orphanedConflictId: null,
    };
  }

  return { closed: true, reason: null, orphanedConflictId: live.conflictId ?? null };
}
