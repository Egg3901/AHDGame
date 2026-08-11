import type { Db, ObjectId } from "mongodb";
import type { PoliticalParty } from "@/lib/db/types";

/**
 * Vacate party leadership slots (chair / vice chair / treasurer) that still
 * reference characters who have just left for another party.
 *
 * Founding or defecting into a new party is a party-switch: the canonical
 * `parties/[id]/leave` route nulls whichever leadership slot the leaver held,
 * but the bulk party-split paths (charter ratification, one-party-state
 * faction split) only moved `character.party` — they never cleared the old
 * party's leadership. That left a party still listing leaders who had left
 * (bug #0701: a party whose entire leadership chartered a breakaway kept
 * showing those three as its own chair / VC / treasurer).
 *
 * A single aggregation-pipeline `updateMany` clears the slot wherever it
 * references one of the departed characters, scoped to the country. Pass
 * `exceptPartySequentialId` to exclude the freshly-created party whose
 * leadership was intentionally set to those same characters. `$cond`
 * preserves any slot held by someone who did not depart.
 *
 * No-op when `departedCharacterIds` is empty.
 */
export async function vacateDepartedLeadership(
  db: Db,
  countryId: string,
  departedCharacterIds: ObjectId[],
  opts: { exceptPartySequentialId?: number } = {}
): Promise<void> {
  if (departedCharacterIds.length === 0) return;

  const ids = departedCharacterIds;
  const filter: Record<string, unknown> = {
    countryId,
    $or: [{ chairId: { $in: ids } }, { viceChairId: { $in: ids } }, { treasurerId: { $in: ids } }],
  };
  if (opts.exceptPartySequentialId !== undefined) {
    filter.sequentialId = { $ne: opts.exceptPartySequentialId };
  }

  await db.collection<PoliticalParty>("politicalParties").updateMany(filter, [
    {
      $set: {
        chairId: { $cond: [{ $in: ["$chairId", ids] }, null, "$chairId"] },
        viceChairId: { $cond: [{ $in: ["$viceChairId", ids] }, null, "$viceChairId"] },
        treasurerId: { $cond: [{ $in: ["$treasurerId", ids] }, null, "$treasurerId"] },
        updatedAt: new Date(),
      },
    },
  ]);
}
