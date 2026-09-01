/**
 * Settle the German Question from a peace TERM rather than from a war's outcome.
 *
 * The ordinary road is `settleFrozenCrisisFromConflict`: the war is fought, somebody
 * wins it, and a turn sweep reads the result. This is the other one. A `reunification`
 * term is the challenger asking for that outcome directly, while the fighting is
 * still going on, so the settlement has to happen when the term is APPLIED rather
 * than on a later tick.
 *
 * Synchronous for the same reason the dictate route applies its term synchronously:
 * the offer has been accepted, and a player who has just agreed to reunification
 * should not load a map that still shows two Germanies until the next hour turns.
 *
 * ONLY EVER THE CHALLENGER. `validatePeaceTerm` refuses the term from anyone else,
 * and the outcome is hardcoded here rather than passed in, so a future caller cannot
 * quietly use this to hand the question to the incumbent. The incumbent outcome is
 * not a settlement anybody imposes: it is what happens when nothing changes.
 */
import type { Db } from "mongodb";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import { actuateSettlementOutcome } from "@/lib/settlement/actuate";

export interface ReunifyByTermResult {
  actuated: boolean;
}

const NOT_ACTUATED: ReunifyByTermResult = { actuated: false };

export async function reunifyByPeaceTerm(
  db: Db,
  conflictId: string,
  currentTurn: number
): Promise<ReunifyByTermResult> {
  const crises = await getSettlementCrisesCollection(db);
  const crisis = await crises.findOne({
    conflictId,
    status: "frozen",
  } as Parameters<typeof crises.findOne>[0]);
  // No question on this war is not an error here. `validatePeaceTerm` already refused
  // the term for exactly this case; reaching it means the crisis moved between the
  // check and the apply, and the right answer is to change nothing.
  if (!crisis) return NOT_ACTUATED;

  // Guarded on `frozen`, the same claim `settleFrozenCrisisFromConflict` makes: the
  // actuation this unlocks is not replayable, and a turn sweep can be running against
  // this document at the same moment as the request that got here.
  const claimed = await crises.updateOne(
    { _id: crisis._id, status: "frozen" },
    {
      $set: {
        status: "resolved",
        outcome: "challenger",
        resolvedTurn: currentTurn,
        updatedAt: new Date(),
      },
    }
  );
  if (claimed.matchedCount !== 1) return NOT_ACTUATED;

  // The CLAIMED document, not the one read above. `actuateSettlementOutcome` refuses
  // anything that is not already `resolved` with an outcome, so passing the frozen
  // copy would claim the crisis and then quietly actuate nothing.
  const resolved: SettlementCrisisDoc = {
    ...crisis,
    status: "resolved",
    outcome: "challenger",
    resolvedTurn: currentTurn,
  };
  const result = await actuateSettlementOutcome(db, resolved, currentTurn);
  return { actuated: result.actuated };
}
