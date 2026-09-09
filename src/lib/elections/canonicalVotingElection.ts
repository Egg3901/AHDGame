/**
 * When two voting elections exist for the same seat, the party page and the
 * enter/vote routes must agree on which one is real. Last-write-wins on an
 * unsorted find() showed the later empty duplicate while the unique candidacy
 * index still locked the player to the earlier race (ticket #1295).
 *
 * Canonical = earliest startTurn, then createdAt, then _id.
 */
export const CANONICAL_VOTING_ELECTION_SORT = {
  startTurn: 1,
  createdAt: 1,
  _id: 1,
} as const;

export interface VotingElectionIdentity {
  startTurn?: number;
  createdAt?: Date;
  _id: { toString(): string };
}

export function compareVotingElections(
  left: VotingElectionIdentity,
  right: VotingElectionIdentity
): number {
  const turn = (left.startTurn ?? 0) - (right.startTurn ?? 0);
  if (turn !== 0) return turn;
  const leftTime = left.createdAt instanceof Date ? left.createdAt.getTime() : 0;
  const rightTime = right.createdAt instanceof Date ? right.createdAt.getTime() : 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left._id.toString().localeCompare(right._id.toString());
}

export function pickCanonicalVotingElection<T extends VotingElectionIdentity>(
  elections: T[]
): T | undefined {
  if (elections.length === 0) return undefined;
  return elections.reduce((best, current) =>
    compareVotingElections(current, best) < 0 ? current : best
  );
}

export function pickCanonicalVotingElectionPerKey<T extends VotingElectionIdentity>(
  elections: T[],
  keyOf: (election: T) => string
): T[] {
  const best = new Map<string, T>();
  for (const election of elections) {
    const key = keyOf(election);
    const current = best.get(key);
    if (!current || compareVotingElections(election, current) < 0) {
      best.set(key, election);
    }
  }
  return [...best.values()];
}
