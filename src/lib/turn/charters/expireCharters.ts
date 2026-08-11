import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { PartyCharter } from "@/lib/db/types";

/**
 * Phase 6 — per-turn sweep that transitions charters past their deadline
 * to `expired`. Runs before emptyPartyCleanup so the chartered-party
 * immunity hook reads up-to-date status.
 *
 * Two paths drive expiry per Phase 6 D4:
 *  - `draft` / `pending-signatures` past `expiresAt`
 *  - `founder-replacement` past `founderReplacementDeadline`
 *
 * Migrated / ratified charters never expire (their `expiresAt` is null).
 *
 * See plan §"Phase 6 — Tasks" 6.3.
 */
export interface ExpireChartersResult {
  expiredFromPending: number;
  expiredFromReplacement: number;
}

export async function expireCharters(
  currentTurn: number,
  now: Date = new Date(),
  dbOverride?: Db
): Promise<ExpireChartersResult> {
  const db = dbOverride ?? (await getDb());
  const charters = db.collection<PartyCharter>("partyCharters");

  // Turn-first: expire when the processed turn reaches the deadline turn, so a
  // paused game freezes the countdown. `now` (game clock) drives the Date
  // fallback for charters not yet backfilled. The `*: null` fallback clause
  // matches both missing and explicit-null turn fields; ratified/migrated
  // charters (turn AND Date both null) match neither clause and never expire.
  const pendingResult = await charters.updateMany(
    {
      status: { $in: ["draft", "pending-signatures"] },
      $or: [
        { expiresOnTurn: { $ne: null, $lte: currentTurn } },
        { expiresOnTurn: null, expiresAt: { $ne: null, $lte: now } },
      ],
    },
    {
      $set: { status: "expired", updatedAt: now },
    }
  );

  const replacementResult = await charters.updateMany(
    {
      status: "founder-replacement",
      $or: [
        { founderReplacementDeadlineTurn: { $ne: null, $lte: currentTurn } },
        {
          founderReplacementDeadlineTurn: null,
          founderReplacementDeadline: { $ne: null, $lte: now },
        },
      ],
    },
    {
      $set: { status: "expired", updatedAt: now },
    }
  );

  return {
    expiredFromPending: pendingResult.modifiedCount,
    expiredFromReplacement: replacementResult.modifiedCount,
  };
}
