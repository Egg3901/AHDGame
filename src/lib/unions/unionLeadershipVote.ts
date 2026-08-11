import type { UnionLeaderVote } from "@/lib/db/types/union";

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

/** Plurality winner among deduped votes, or null when no votes cast. */
export function tallyUnionLeaderVotes(
  votes: UnionLeaderVote[]
): { leaderId: string; voteCount: number } | null {
  const deduped = dedupeUnionLeaderVotes(votes);
  const counts = new Map<string, number>();
  for (const vote of deduped) {
    const cid = vote.candidateCharacterId.toString();
    counts.set(cid, (counts.get(cid) ?? 0) + 1);
  }
  let leaderId: string | null = null;
  let maxVotes = 0;
  for (const [cid, count] of counts) {
    if (count > maxVotes) {
      maxVotes = count;
      leaderId = cid;
    }
  }
  return leaderId ? { leaderId, voteCount: maxVotes } : null;
}
