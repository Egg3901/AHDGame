import type { Db } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import type { ElectedOfficial, NPP, SpeakerVacateMotion } from "@/lib/db/types";
import {
  loadVacateSpeakerContext,
  nppStance,
  nppVacateMotionVote,
  type VacateVoteValue,
} from "./nppVacateVote";

/**
 * Give every unvoted NPP bloc a graded ballot on the motion to vacate.
 *
 * Congressional leadership elections are player-only for NPPs by design (see
 * `lib/turn/nppBehavior.ts`), but a motion to vacate is not an election: it
 * carries only on an absolute majority of ALL chamber seats, the same
 * all-seats bar impeachment uses. With blocs silent that bar is unreachable,
 * so the motion could never carry however the humans voted. This mirrors
 * {@link autoVoteNppsForImpeachmentStage} rather than the election path.
 *
 * Existing ballots are never overwritten, so a whip issued earlier stays
 * authoritative. Call this only once the voting window has closed: running it
 * while the motion is live would let blocs carry it before anyone had a chance
 * to whip them.
 *
 * The returned map merges the votes written by this pass into the motion's
 * existing ones, so the caller can tally without a second read.
 */
export async function autoVoteNppsForVacateMotion(
  db: Db,
  motion: SpeakerVacateMotion,
  rng: () => number = Math.random
): Promise<Record<string, VacateVoteValue>> {
  if (motion.status !== "voting") return motion.votes ?? {};

  const votes: Record<string, VacateVoteValue> = { ...(motion.votes ?? {}) };

  // Plain `countryId` on purpose, NOT the `$or: [{countryId}, {$exists: false}]`
  // legacy-tolerant form used elsewhere for US rows. The tally this feeds
  // (computeCongressLeadershipTally → buildVoterPartyAndWeightMaps) filters on
  // a plain countryId too, so a row missing it carries no seat weight and its
  // ballot would be discarded. Widening this without widening the tally would
  // just write votes that never count.
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ countryId: "US", officeType: "house", isNPP: true })
    .project<Pick<ElectedOfficial, "nppId">>({ nppId: 1 })
    .toArray();

  const nppIdList = officials
    .map((official) => official.nppId)
    .filter((id): id is ObjectId => id instanceof ObjectId);
  if (nppIdList.length === 0) return votes;

  const [nppDocs, speakerContext] = await Promise.all([
    db
      .collection<NPP>("npps")
      .find({ _id: { $in: nppIdList } })
      .project<Pick<NPP, "_id" | "party" | "policies">>({ _id: 1, party: 1, policies: 1 })
      .toArray(),
    loadVacateSpeakerContext(db, motion),
  ]);
  const nppById = new Map(nppDocs.map((npp) => [npp._id.toString(), npp]));

  const now = new Date();
  const seenNppIds = new Set<string>();
  const ops: Array<{
    updateOne: {
      filter: Record<string, unknown>;
      update: { $set: Record<string, unknown> };
    };
  }> = [];

  for (const official of officials) {
    if (!official.nppId) continue;
    const nppId = official.nppId.toString();
    if (seenNppIds.has(nppId)) continue;
    seenNppIds.add(nppId);

    const nppKey = `npp_${nppId}`;
    if (votes[nppKey]) continue;

    const npp = nppById.get(nppId);
    const choice = nppVacateMotionVote({
      nppParty: npp?.party,
      nppStance: nppStance(npp),
      speakerParty: speakerContext.speakerParty,
      speakerStance: speakerContext.speakerStance,
      majorPartyIds: speakerContext.majorPartyIds,
      rng,
    });

    // Each op carries its own `$exists: false` guard, so a whip or a member's
    // own vote landing between the read above and this write is never
    // clobbered. Batched into one round trip because resolution is lazy and
    // runs inside a page read: a write per bloc would stall the Speaker page.
    ops.push({
      updateOne: {
        filter: { _id: "current", status: "voting", [`votes.${nppKey}`]: { $exists: false } },
        update: { $set: { [`votes.${nppKey}`]: choice, updatedAt: now } },
      },
    });
  }

  if (ops.length === 0) return votes;

  await db.collection<SpeakerVacateMotion>("speakerVacateMotions").bulkWrite(ops);

  // Re-read rather than assuming every op applied: a guard may have rejected
  // one, and the tally that follows must run on what the motion actually holds.
  const updated = await db
    .collection<SpeakerVacateMotion>("speakerVacateMotions")
    .findOne({ _id: "current" }, { projection: { votes: 1 } });

  return updated?.votes ?? votes;
}
