import type { Db } from "mongodb";

/**
 * Temporary freeze on NEW defence procurement.
 *
 * Reads `gameState.defenceProcurementPaused` off the singleton `_id: "current"` doc — the
 * same projection pattern `battleAuthz` uses for `conflictsEnabled`, deliberately NOT filtered
 * on `isActive` (that field is frequently false on the current doc and is not what gates a
 * flag).
 *
 * When true, the two routes that create a NEW delivery obligation refuse: awarding a contract
 * and a CEO accepting a pending offer. Everything already active is untouched — the delivery
 * sweep keeps settling live contracts, and cancel/decline stay open so a minister or CEO can
 * still wind an order down. This is a kill switch for a procurement-drain exploit, not a
 * teardown of the subsystem; flip it back to resume.
 */
export async function isDefenceProcurementPaused(db: Db): Promise<boolean> {
  const gs = await db
    .collection<{ _id: string; defenceProcurementPaused?: boolean }>("gameState")
    .findOne({ _id: "current" }, { projection: { defenceProcurementPaused: 1 } });
  return gs?.defenceProcurementPaused === true;
}

/** Message shown when procurement is frozen — shared by both entry points for one voice. */
export const DEFENCE_PROCUREMENT_PAUSED_MESSAGE =
  "Defence procurement is temporarily frozen. Existing contracts continue to deliver, but no " +
  "new contracts can be awarded or accepted right now.";
