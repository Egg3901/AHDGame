import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  getCommittedLane,
  getPassedDecadeIds,
  getUnlockedNodes,
  sumStrengthGrants,
} from "@/lib/constants/techTree";

export type AbandonTechDecadeResult =
  | { ok: true; status: 200; decadeId: string; removedNodeIds: string[] }
  | { ok: false; status: number; error: string };

/**
 * Abandon a decade's committed lane: clears the lane commitment, removes that
 * decade's unlocked nodes, and reverses their one-time strength grants. NO
 * refund of rdScore or cash (the point of commitment). Per-turn margin/growth
 * effects drop automatically since they recompute from the unlocked set.
 *
 * Only researchable decades can be abandoned — auto-granted past-decade
 * corporate tech is permanent baseline and cannot be dropped.
 */
export async function abandonTechDecade(
  db: Db,
  corporation: Corporation,
  decadeId: string,
  currentYear: number
): Promise<AbandonTechDecadeResult> {
  const corpView = {
    type: corporation.type,
    unlockedTechNodeIds: corporation.unlockedTechNodeIds,
    techDecadeLane: corporation.techDecadeLane,
  };

  if (getPassedDecadeIds(currentYear).includes(decadeId)) {
    return {
      ok: false,
      status: 400,
      error: "Baseline tech from past decades cannot be abandoned.",
    };
  }
  if (getCommittedLane(corpView, decadeId) === undefined) {
    return { ok: false, status: 400, error: "No technology is committed for that decade." };
  }

  const decadeNodes = getUnlockedNodes(corpView).filter((n) => n.decadeId === decadeId);
  const removedNodeIds = decadeNodes.map((n) => n.id);
  const grants = sumStrengthGrants(decadeNodes.flatMap((n) => n.effects));

  // Reverse strength grants (floor at 0 so we never push strength negative).
  const dec: Record<string, number> = {};
  if (grants.marketingStrength > 0) {
    dec.marketingStrength = -Math.min(grants.marketingStrength, corporation.marketingStrength ?? 0);
  }
  if (grants.logisticsStrength > 0) {
    dec.logisticsStrength = -Math.min(grants.logisticsStrength, corporation.logisticsStrength ?? 0);
  }

  const update: Record<string, unknown> = {
    $pull: { unlockedTechNodeIds: { $in: removedNodeIds } },
    $unset: { [`techDecadeLane.${decadeId}`]: "", [`techDecadeChosenTurn.${decadeId}`]: "" },
    $set: { updatedAt: new Date() },
  };
  if (Object.keys(dec).length > 0) update.$inc = dec;

  const res = await db
    .collection<Corporation>("corporations")
    .updateOne({ _id: corporation._id }, update);

  if (res.modifiedCount === 0) {
    return { ok: false, status: 409, error: "Abandon could not be completed — please retry." };
  }

  return { ok: true, status: 200, decadeId, removedNodeIds };
}
