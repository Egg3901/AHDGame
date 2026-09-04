/**
 * Live state actions: what one candidate currently has running against another
 * in a named state.
 *
 * Rows carry their own expiry so effects decay on their own. Nothing sweeps
 * them at resolution, which is how `statePartyOrg.primarySurge` came to be read
 * by four call sites and written by none.
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

/**
 * Favourability points per turn each target is losing, summed across every
 * state they are being hit in.
 *
 * Keyed by target CHARACTER id, because that is what `campaignTurn`'s
 * favourability map resolves against. Keying on the candidate row id would
 * charge the attacker and move nobody.
 *
 * The shield is the one stamped on the row at purchase, not the attacker's or
 * defender's current tree: an action already paid for keeps the terms it was
 * bought under, exactly as `primarySurgeBoost` does.
 */
export function localFavorabilityDrainByTarget(actions: PrimaryStateAction[]): Map<string, number> {
  const byTarget = new Map<string, number>();
  for (const a of actions) {
    if (a.kind !== "localFavorability") continue;
    const key = a.targetCharacterId.toString();
    const effective = a.magnitude * (1 - a.shieldApplied);
    byTarget.set(key, (byTarget.get(key) ?? 0) + effective);
  }
  return byTarget;
}
