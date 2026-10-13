// src/lib/turn/justiceActionReset.ts
import type { Db } from "@/lib/mongodb";
import type { SupremeCourtSeat } from "@/lib/db/types/scotus";
import { JUSTICE_ACTION_ACCRUAL_TURNS, JUSTICE_ACTION_CAP } from "@/lib/constants/justiceActions";
import { isOfficePoolAccrualTurn } from "@/lib/actions/officePoolAccrual";

/**
 * Accrue every seated Justice's self-serve action pool: +1 every
 * `JUSTICE_ACTION_ACCRUAL_TURNS` turns, banked up to `JUSTICE_ACTION_CAP`.
 * Mirrors `resetVicePresidentActions`: one conditional `updateMany` that only
 * matches occupied seats below cap that have not accrued this turn, so a
 * re-run of the phase is a no-op. NPP/historical-held seats accrue harmlessly
 * (no player to spend them).
 */
export async function resetJusticeActions(
  db: Db,
  currentTurn: number
): Promise<{ justiceActionsRegenerated: number }> {
  if (!isOfficePoolAccrualTurn(currentTurn, JUSTICE_ACTION_ACCRUAL_TURNS)) {
    return { justiceActionsRegenerated: 0 };
  }
  const result = await db.collection<SupremeCourtSeat>("supremeCourtSeats").updateMany(
    {
      justiceCharacterId: { $ne: null },
      justiceActionsRemaining: { $lt: JUSTICE_ACTION_CAP },
      lastJusticeActionAccrualTurn: { $ne: currentTurn },
    },
    {
      $inc: { justiceActionsRemaining: 1 },
      $set: { lastJusticeActionAccrualTurn: currentTurn },
    }
  );
  return { justiceActionsRegenerated: result.modifiedCount };
}
