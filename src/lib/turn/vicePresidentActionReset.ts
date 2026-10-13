// src/lib/turn/vicePresidentActionReset.ts
import type { Db } from "@/lib/mongodb";
import type { ElectedOfficial } from "@/lib/db/types";
import { VP_ACTION_ACCRUAL_TURNS, VP_ACTION_CAP } from "@/lib/constants/vicePresidentActions";
import { isOfficePoolAccrualTurn } from "@/lib/actions/officePoolAccrual";

/**
 * Accrue the seated vice-president's self-serve action pool (player
 * suggestion #67): +1 every `VP_ACTION_ACCRUAL_TURNS` turns, banked up to
 * `VP_ACTION_CAP`. Same daily throughput as the old midnight refill (2 per
 * day at 1 turn per hour), but unspent actions bank instead of resetting.
 *
 * One conditional `updateMany`: only pools below cap that have not already
 * accrued this turn match, so a re-run of the phase is a no-op. Legacy docs
 * without a pool field never match and are backfilled to the cap lazily by
 * the action route. NPP-held VP seats accrue harmlessly (they never spend).
 */
export async function resetVicePresidentActions(
  db: Db,
  currentTurn: number
): Promise<{ vpActionsRegenerated: number }> {
  if (!isOfficePoolAccrualTurn(currentTurn, VP_ACTION_ACCRUAL_TURNS)) {
    return { vpActionsRegenerated: 0 };
  }
  const result = await db.collection<ElectedOfficial>("electedOfficials").updateMany(
    {
      officeType: "vicePresident",
      vpActionsRemaining: { $lt: VP_ACTION_CAP },
      lastVpActionAccrualTurn: { $ne: currentTurn },
    },
    {
      $inc: { vpActionsRemaining: 1 },
      $set: { lastVpActionAccrualTurn: currentTurn },
    }
  );
  return { vpActionsRegenerated: result.modifiedCount };
}
