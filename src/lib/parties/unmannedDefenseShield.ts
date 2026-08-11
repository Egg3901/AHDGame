/**
 * Unmanned-default capture shield (2026-06-18 D3).
 *
 * Reduces the effect of actions that ATTACK a target party's metrics (the
 * Build Org rival-poach, Suppression) when the target is a *default* party with
 * no active human chair — i.e. an abandoned DEM/REP-style stronghold. Without
 * this, a PS-rich rival can grind an unmanned default party's Org/turnout to
 * nothing, eroding the baseline two-party landscape new players rely on.
 *
 * Keyed on the national party chair (`isUnmannedDefault`). Applies only to the
 * reduction inflicted on the target (the poach slice) — never to the share a
 * party draws from the Unaffiliated pool.
 */
import type { Db, ObjectId } from "mongodb";
import type { Character, PoliticalParty } from "@/lib/db/types";
import {
  DEFENSE_UNMANNED_CAPTURE_MULTIPLIER,
  isUnmannedDefault,
} from "@/lib/turn/partyOrg/defenseConstants";

/**
 * Is the party's chair seat held by an active (non-banned) human player?
 * A chair is NOT an active human when: the seat is vacant (`chairId == null`),
 * the chair character is an NPP (no `userId`), or the chair's user is banned.
 */
async function isActiveHumanChair(db: Db, chairId: PoliticalParty["chairId"]): Promise<boolean> {
  if (!chairId) return false;
  const chair = await db
    .collection<Character>("characters")
    .findOne({ _id: chairId as ObjectId }, { projection: { userId: 1 } });
  if (!chair?.userId) return false;
  const user = await db
    .collection("users")
    .findOne({ _id: chair.userId, isBanned: { $ne: true } }, { projection: { _id: 1 } });
  return !!user;
}

/**
 * Capture-rate multiplier for an action that REDUCES the target party's metrics.
 * Returns `DEFENSE_UNMANNED_CAPTURE_MULTIPLIER` (0.5) when the target is a
 * default party with no active human chair, else `1` (full effect).
 */
export async function resolveUnmannedDefaultCaptureMultiplier(
  db: Db,
  targetParty: Pick<PoliticalParty, "isDefault" | "chairId">
): Promise<number> {
  const unmanned = await isUnmannedDefault(targetParty as PoliticalParty, (chairId) =>
    isActiveHumanChair(db, chairId)
  );
  return unmanned ? DEFENSE_UNMANNED_CAPTURE_MULTIPLIER : 1;
}
