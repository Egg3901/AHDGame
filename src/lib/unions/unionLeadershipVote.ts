import type { Db, ObjectId } from "mongodb";
import type { Union, UnionLeaderVote, UnionOrganizer } from "@/lib/db/types/union";

/** Load every organizer's banked strength for one union, keyed by character id. */
export async function loadUnionVoteWeights(db: Db, unionId: ObjectId): Promise<UnionVoteWeights> {
  const organizers = await db
    .collection<UnionOrganizer>("unionOrganizers")
    .find({ unionId }, { projection: { characterId: 1, strength: 1 } })
    .toArray();
  const weights: UnionVoteWeights = new Map();
  for (const organizer of organizers) {
    const strength = organizer.strength;
    if (typeof strength === "number" && Number.isFinite(strength) && strength > 0) {
      weights.set(organizer.characterId.toString(), strength);
    }
  }
  return weights;
}

/** Latest vote per organizer — mirrors corporation CEO vote dedupe. */
export function dedupeUnionLeaderVotes(votes: UnionLeaderVote[]): UnionLeaderVote[] {
  const latestByVoter = new Map<string, UnionLeaderVote>();
  for (const vote of votes) {
    const voterKey = vote.voterCharacterId.toString();
    const existing = latestByVoter.get(voterKey);
    if (!existing) {
      latestByVoter.set(voterKey, vote);
      continue;
    }
    const voteTime = vote.updatedAt?.getTime?.() ?? vote.createdAt.getTime();
    const existingTime = existing.updatedAt?.getTime?.() ?? existing.createdAt.getTime();
    if (
      voteTime > existingTime ||
      (voteTime === existingTime && vote._id.toString() > existing._id.toString())
    ) {
      latestByVoter.set(voterKey, vote);
    }
  }
  return [...latestByVoter.values()];
}

/**
 * Vote weight per voter: the organizer's banked strength. A voter absent from
 * the map, or holding no strength, casts nothing. Leadership follows organizing
 * effort, so someone who ran fifty drives outvotes someone who ran one.
 */
export type UnionVoteWeights = Map<string, number>;

/** Sum of banked strength backing each candidate. */
export function tallyUnionLeaderVoteWeights(
  votes: UnionLeaderVote[],
  weights: UnionVoteWeights
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const vote of dedupeUnionLeaderVotes(votes)) {
    const weight = weights.get(vote.voterCharacterId.toString()) ?? 0;
    if (!(weight > 0)) continue;
    const cid = vote.candidateCharacterId.toString();
    counts.set(cid, (counts.get(cid) ?? 0) + weight);
  }
  return counts;
}

/**
 * Leading candidate by banked strength, or null when nothing is backing anyone.
 * A tie goes to the sitting president (when that president is a character id in
 * the tally): the challenger has to actually out-vote the incumbent, mirroring
 * corporation CEO contests. NPP incumbents are not character candidates, so a
 * tie among player candidates still picks one by insertion order among equals.
 */
export function leadingUnionCandidate(
  counts: Map<string, number>,
  incumbentId: string | null
): string | null {
  let leaderId: string | null = null;
  let maxVotes = 0;
  for (const [cid, count] of counts) {
    if (count > maxVotes || (count === maxVotes && incumbentId != null && cid === incumbentId)) {
      maxVotes = count;
      leaderId = cid;
    }
  }
  return leaderId;
}

/**
 * Winner by total banked strength, or null when nothing is backing anyone.
 * `voteCount` is that winning strength total, not a headcount.
 * Pass `incumbentId` (seated character president) so ties keep the incumbent.
 */
export function tallyUnionLeaderVotes(
  votes: UnionLeaderVote[],
  weights: UnionVoteWeights,
  incumbentId: string | null = null
): { leaderId: string; voteCount: number } | null {
  const counts = tallyUnionLeaderVoteWeights(votes, weights);
  const leaderId = leadingUnionCandidate(counts, incumbentId);
  if (!leaderId) return null;
  return { leaderId, voteCount: counts.get(leaderId) ?? 0 };
}

/** Sitting player president id, or null when vacant / NPP-held. */
export function seatedPlayerPresidentId(
  union: Pick<Union, "ownerId" | "ownerType">
): string | null {
  if (union.ownerId == null) return null;
  if (union.ownerType === "npp") return null;
  return union.ownerId.toString();
}
