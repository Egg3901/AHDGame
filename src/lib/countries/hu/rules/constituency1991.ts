/**
 * Hungarian constituencies in 1991 require a valid turnout and majority first
 * round, then a qualified plurality runoff. Losing votes from the first valid
 * round compensate parties; winners contribute no surplus votes.
 * https://njt.jog.gov.hu/jogszabaly/1989-34-00-00.0
 */
export interface Hu1991CandidateVote {
  candidateId: string;
  partyId: string;
  votes: number;
}

export interface Hu1991ConstituencyRound {
  registeredVoters: number;
  ballotsCast: number;
  candidates: readonly Hu1991CandidateVote[];
}

export type Hu1991ConstituencyResult =
  | { kind: "runoff"; candidateIds: string[]; firstRoundValid: boolean }
  | {
      kind: "elected" | "vacant";
      winnerId: string | null;
      winnerParty: string | null;
      compensationVotes: Record<string, number>;
      reason?: "invalid-turnout" | "tied-plurality" | "no-candidates";
    };

function validateRound(round: Hu1991ConstituencyRound): number {
  if (
    !Number.isSafeInteger(round.registeredVoters) ||
    round.registeredVoters < 1 ||
    !Number.isSafeInteger(round.ballotsCast) ||
    round.ballotsCast < 0 ||
    round.ballotsCast > round.registeredVoters
  )
    throw new Error("Invalid Hungarian constituency electorate or turnout");
  const ids = new Set<string>();
  let total = BigInt(0);
  for (const row of round.candidates) {
    if (
      !row.candidateId ||
      !row.partyId ||
      ids.has(row.candidateId) ||
      !Number.isSafeInteger(row.votes) ||
      row.votes < 0
    )
      throw new Error("Invalid Hungarian constituency candidate or votes");
    ids.add(row.candidateId);
    total += BigInt(row.votes);
  }
  if (total > BigInt(round.ballotsCast))
    throw new Error("Hungarian constituency valid votes exceed turnout");
  return Number(total);
}

export function countHu1991Constituency(
  first: Hu1991ConstituencyRound,
  second?: Hu1991ConstituencyRound
): Hu1991ConstituencyResult {
  const firstTotal = validateRound(first);
  const firstValid = BigInt(first.ballotsCast) * BigInt(2) > BigInt(first.registeredVoters);
  const ranked = [...first.candidates].sort(
    (a, b) => b.votes - a.votes || a.candidateId.localeCompare(b.candidateId)
  );
  const firstWinner =
    firstValid && ranked[0] && BigInt(ranked[0].votes) * BigInt(2) > BigInt(firstTotal)
      ? ranked[0]
      : null;
  if (firstWinner && second)
    throw new Error("Hungarian constituency already elected a first-round winner");
  function finish(
    winner: Hu1991CandidateVote | null,
    compensatingRound: Hu1991ConstituencyRound | null,
    reason?: "invalid-turnout" | "tied-plurality" | "no-candidates"
  ): Hu1991ConstituencyResult {
    const compensationVotes: Record<string, number> = {};
    for (const row of compensatingRound?.candidates ?? []) {
      if (row.candidateId === winner?.candidateId || row.partyId === "independent") continue;
      compensationVotes[row.partyId] = (compensationVotes[row.partyId] ?? 0) + row.votes;
    }
    return {
      kind: winner ? "elected" : "vacant",
      winnerId: winner?.candidateId ?? null,
      winnerParty: winner?.partyId ?? null,
      compensationVotes,
      ...(reason ? { reason } : {}),
    };
  }
  if (firstWinner) return finish(firstWinner, first);
  if (!ranked.length) return finish(null, null, "no-candidates");
  const aboveFifteen = ranked.filter(
    (row) => BigInt(row.votes) * BigInt(100) >= BigInt(firstTotal) * BigInt(15)
  );
  // A tie at the third-place qualification boundary retains every tied person.
  // This bounded ballot policy never breaks an actual tied winning plurality.
  const cutoff = ranked[Math.min(2, ranked.length - 1)].votes;
  const qualifiers = firstValid
    ? aboveFifteen.length >= 3
      ? aboveFifteen
      : ranked.filter((row) => row.votes >= cutoff)
    : ranked;
  if (!second)
    return {
      kind: "runoff",
      candidateIds: qualifiers.map((row) => row.candidateId),
      firstRoundValid: firstValid,
    };
  validateRound(second);
  if (second.registeredVoters !== first.registeredVoters)
    throw new Error("Hungarian runoff must retain its frozen electorate");
  const byId = new Map(qualifiers.map((row) => [row.candidateId, row]));
  for (const row of second.candidates) {
    if (byId.get(row.candidateId)?.partyId !== row.partyId)
      throw new Error("Hungarian runoff contains an unqualified or changed nominee");
  }
  const secondValid = BigInt(second.ballotsCast) * BigInt(4) > BigInt(second.registeredVoters);
  const compensatingRound = firstValid ? first : secondValid ? second : null;
  if (!secondValid) return finish(null, compensatingRound, "invalid-turnout");
  const finalRank = [...second.candidates].sort((a, b) => b.votes - a.votes);
  if (!finalRank.length || finalRank[0].votes === 0)
    return finish(null, compensatingRound, "no-candidates");
  if (finalRank[1]?.votes === finalRank[0].votes)
    return finish(null, compensatingRound, "tied-plurality");
  return finish(finalRank[0], compensatingRound);
}
