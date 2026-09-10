/**
 * Live state actions: what one candidate currently has running against another
 * in a named state.
 *
 * Rows carry their own expiry so effects decay on their own. Nothing sweeps
 * them at resolution, which is how `statePartyOrg.primarySurge` came to be read
 * by four call sites and written by none.
 *
 * What each kind DOES with a row lives in `electionEngine/constants`
 * (`stateAttackMultiplier`, `stateFavorabilityDeltas`), read by the stagger and
 * the projection alike. Nothing here interprets a row's effect.
 */

import type { Db, Filter, ObjectId } from "mongodb";
import type { PrimaryStateAction } from "@/lib/db/types";

/**
 * Rows still in force this turn.
 *
 * `expiresTurn` is exclusive: a row expiring on turn 18 is live on 17 and gone
 * on 18.
 */
export function liveActionFilter(
  electionId: ObjectId,
  currentTurn: number
): Filter<PrimaryStateAction> {
  return { electionId, expiresTurn: { $gt: currentTurn } };
}

export async function loadLiveStateActions(
  db: Db,
  args: { electionId: ObjectId; currentTurn: number }
): Promise<PrimaryStateAction[]> {
  return db
    .collection<PrimaryStateAction>("primaryStateActions")
    .find(liveActionFilter(args.electionId, args.currentTurn))
    .toArray();
}

/**
 * The same read across several races at once.
 *
 * The turn processor handles every active election in one pass rather than one
 * at a time, so it needs the whole set in a single query instead of one per
 * race.
 */
export async function loadLiveStateActionsForElections(
  db: Db,
  args: { electionIds: ObjectId[]; currentTurn: number }
): Promise<PrimaryStateAction[]> {
  if (args.electionIds.length === 0) return [];
  return db
    .collection<PrimaryStateAction>("primaryStateActions")
    .find({
      electionId: { $in: args.electionIds },
      expiresTurn: { $gt: args.currentTurn },
    })
    .toArray();
}
