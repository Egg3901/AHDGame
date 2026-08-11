import { type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { DIPLOMATIC_ACTIONS_PER_TURN } from "@/lib/constants/internationalOrganizations";
import type { DiplomaticActionBudget } from "@/lib/db/types/diplomaticAction";
import { getDiplomaticActionsCollection } from "@/lib/db/collections";

/**
 * Actions left for a stored budget row at `currentTurn`. A missing or stale
 * (older-turn) row reads as a full budget — the refresh happens on the next
 * spend. Pure so the turn-refresh + clamping logic is unit-tested directly.
 */
export function remainingFromRow(
  row: Pick<DiplomaticActionBudget, "turn" | "remaining"> | null,
  currentTurn: number
): number {
  if (!row || row.turn < currentTurn) return DIPLOMATIC_ACTIONS_PER_TURN;
  return Math.max(0, Math.min(DIPLOMATIC_ACTIONS_PER_TURN, row.remaining));
}

/** Actions a country has left this turn. */
export async function getDiplomaticActionsRemaining(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<number> {
  const col = await getDiplomaticActionsCollection(db);
  const row = await col.findOne({ countryId });
  return remainingFromRow(row, currentTurn);
}

/**
 * Spend one diplomatic action. Reads the current budget (refreshing a
 * missing/stale row to full for `currentTurn`), then writes the decremented
 * count. Returns `{ ok: false, remaining: 0 }` when the budget is exhausted.
 *
 * Read-modify-write (matching the `character.actions` refresh pattern). The
 * per-country, per-turn budget sees little concurrency, so a guarded atomic
 * decrement is unnecessary here.
 */
export async function spendDiplomaticAction(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<{ ok: boolean; remaining: number }> {
  const col = await getDiplomaticActionsCollection(db);
  const row = await col.findOne({ countryId });
  const current = remainingFromRow(row, currentTurn);
  if (current < 1) {
    return { ok: false, remaining: 0 };
  }
  const remaining = current - 1;
  await col.updateOne(
    { countryId },
    { $set: { countryId, turn: currentTurn, remaining, updatedAt: new Date() } },
    { upsert: true }
  );
  return { ok: true, remaining };
}
