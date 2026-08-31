import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { activeProcurementRestriction } from "@/lib/db/collections/procurementRestrictions";

/**
 * Temporary freeze on NEW defence procurement.
 *
 * Reads `gameState.defenceProcurementPaused` off the singleton `_id: "current"` doc - the
 * same projection pattern `battleAuthz` uses for `conflictsEnabled`, deliberately NOT filtered
 * on `isActive` (that field is frequently false on the current doc and is not what gates a
 * flag).
 *
 * When true, the two routes that create a NEW delivery obligation refuse: awarding a contract
 * and a CEO accepting a pending offer. Everything already active is untouched - the delivery
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

/** Message shown when procurement is frozen - shared by both entry points for one voice. */
export const DEFENCE_PROCUREMENT_PAUSED_MESSAGE =
  "Defence procurement is temporarily frozen. Existing contracts continue to deliver, but no " +
  "new contracts can be awarded or accepted right now.";

/**
 * Message for a country barred by the terms of a peace settlement.
 *
 * Names the lapse turn, because a bar a minister can see the end of is a fact they
 * can plan around, while one that only says "no" is a wall. Player-facing copy, so
 * no em or en dashes.
 */
export function procurementRestrictedMessage(until: number): string {
  return (
    "This country cannot award new defence contracts under the terms of a peace settlement. " +
    `The restriction lapses on turn ${until}. Existing contracts continue to deliver, and ` +
    "orders already placed can still be wound down."
  );
}

export type ProcurementGateResult =
  { blocked: false } | { blocked: true; reason: string; until: number | null };

/**
 * Is this country barred from creating a NEW delivery obligation?
 *
 * Widened from the global-only `isDefenceProcurementPaused` so a peace settlement
 * can bar one country without touching the world switch.
 *
 * THE GLOBAL SWITCH IS CHECKED FIRST, and keeps its own message. The two are not
 * the same thing: one is a kill switch for a procurement-drain exploit, the other
 * is a term of a settlement, and a minister told the wrong one would go looking for
 * the wrong fix. Its `until` is null because a kill switch has no scheduled end.
 */
export async function isProcurementBlocked(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<ProcurementGateResult> {
  if (await isDefenceProcurementPaused(db)) {
    return { blocked: true, reason: DEFENCE_PROCUREMENT_PAUSED_MESSAGE, until: null };
  }
  const until = await activeProcurementRestriction(db, countryId, currentTurn);
  if (until != null) {
    return { blocked: true, reason: procurementRestrictedMessage(until), until };
  }
  return { blocked: false };
}
