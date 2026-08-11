import type { BillVoteValue } from "@/lib/congress/billVoting";
import type { BillVoteSnapshot } from "@/lib/db/types/voteSnapshot";

export type { BillVoteSnapshot };

interface ScopeResultLike {
  votes: Record<string, BillVoteValue> | undefined;
  weightMap: Map<string, number>;
  totals: { for: number; against: number; abstain: number };
}

/** Serialize a live scope result into a persistable snapshot. */
export function toVoteSnapshot(scoped: ScopeResultLike, resolvedAtTurn: number): BillVoteSnapshot {
  const votes: Record<string, BillVoteValue> = { ...(scoped.votes ?? {}) };
  const weights: Record<string, number> = {};
  for (const key of Object.keys(votes)) {
    weights[key] = scoped.weightMap.get(key) ?? 1;
  }
  return {
    votes,
    weights,
    totals: { ...scoped.totals },
    resolvedAtTurn,
  };
}

/** Rebuild the weight Map from a stored snapshot for buildVotesByParty. */
export function snapshotWeightMap(snapshot: BillVoteSnapshot): Map<string, number> {
  return new Map(Object.entries(snapshot.weights));
}
