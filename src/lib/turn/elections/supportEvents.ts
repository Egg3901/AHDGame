/**
 * Phase B Support-mutation hooks for discrete events: scandals,
 * endorsements landing, debate outcomes.
 *
 * Each helper applies a calibrated bump (positive or negative) to
 * `electionCandidates.support` for every active candidate row of a
 * given character. Clamps to [0, 100] post-write.
 *
 * Callers:
 *   - `applyScandalSupportPenalty` — placeholder for B2. No production
 *     callers yet because the codebase has no discrete "scandal" event
 *     system. When a scandal-event system lands, it should call this
 *     helper at scandal-creation time.
 *   - `applyEndorsementSupportBump` — wired in B3 to every endorsement
 *     write path (executive / governor / NPP / player). Symmetric:
 *     revoking an endorsement applies the negative form.
 *   - `applyDebateOutcomeSupportBump` — B4 stub. No debate infrastructure
 *     exists; this is here so a future debate system has a single hook.
 *
 * All helpers are idempotent-safe — calling twice with the same severity
 * applies the bump twice. Callers should rate-limit / dedupe at their
 * level (e.g. an endorsement only fires once per landing).
 */

import type { Db, ObjectId } from "mongodb";
import type { ElectionCandidate } from "@/lib/db/types";
import {
  SUPPORT_SCANDAL_PENALTY,
  SUPPORT_ENDORSEMENT_BUMP,
  SUPPORT_DEBATE_WIN_BUMP,
} from "@/lib/electionEngine/electionFormulaFactors";

/**
 * Apply a `delta` Support change to every active candidate row of the
 * given character, clamping to [0, 100]. Returns the count of rows
 * updated. Skips silently when no active candidate rows exist (e.g. the
 * character isn't currently running for anything).
 */
async function applySupportDelta(db: Db, characterId: ObjectId, delta: number): Promise<number> {
  if (delta === 0) return 0;
  const result = await db
    .collection<ElectionCandidate>("electionCandidates")
    .updateMany({ characterId, status: "active" }, [
      {
        $set: {
          support: {
            $min: [100, { $max: [0, { $add: [{ $ifNull: ["$support", 50] }, delta] }] }],
          },
        },
      },
    ]);
  return result.modifiedCount;
}

/**
 * Apply the scandal Support penalty to all active candidate rows for
 * the affected character. `severityMultiplier` defaults to 1.0; future
 * scandal-event systems can pass higher multipliers for major scandals
 * (e.g. 2.0 for criminal indictment, 0.5 for minor controversy).
 *
 * No production callers yet — see header comment. Helper is exported
 * so a future scandal-event system has a single hook.
 */
export async function applyScandalSupportPenalty(
  db: Db,
  characterId: ObjectId,
  severityMultiplier: number = 1.0
): Promise<number> {
  const delta = -Math.abs(SUPPORT_SCANDAL_PENALTY * severityMultiplier);
  return applySupportDelta(db, characterId, delta);
}

/**
 * Apply the endorsement Support bump to all active candidate rows for
 * the endorsed character. Pass `revoking: true` to apply the negative
 * form (revocation cleanly reverses the bump from the original
 * landing).
 */
export async function applyEndorsementSupportBump(
  db: Db,
  characterId: ObjectId,
  revoking: boolean = false
): Promise<number> {
  const delta = revoking ? -SUPPORT_ENDORSEMENT_BUMP : SUPPORT_ENDORSEMENT_BUMP;
  return applySupportDelta(db, characterId, delta);
}

/**
 * Apply the debate-win Support bump. Stub for B4 — no debate
 * infrastructure exists. Lands here so a future debate system has a
 * single hook.
 */
export async function applyDebateOutcomeSupportBump(
  db: Db,
  characterId: ObjectId,
  outcome: "win" | "loss" | "draw"
): Promise<number> {
  let delta = 0;
  if (outcome === "win") delta = SUPPORT_DEBATE_WIN_BUMP;
  else if (outcome === "loss") delta = -SUPPORT_DEBATE_WIN_BUMP;
  // draw → 0
  return applySupportDelta(db, characterId, delta);
}
