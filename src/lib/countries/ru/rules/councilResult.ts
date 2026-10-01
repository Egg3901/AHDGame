/**
 * First-Council districts elect two individuals using up to two choices per voter.
 * resolveRussianCouncilBallot counts valid ballots separately from candidate marks,
 * applies the amended quarter-register quorum and preserves the second-seat veto.
 * https://sudact.ru/law/ukaz-prezidenta-rf-ot-11101993-n-1626/
 * https://zakonbase.ru/content/part/12074
 */
export interface RussianCouncilVoteOption {
  id: string;
  votes: number;
  registrationOrder: number;
}
export interface RussianCouncilBallotInput {
  registeredVoters: number;
  validBallots: number;
  againstAllVotes: number;
  options: readonly RussianCouncilVoteOption[];
  invalidated?: boolean;
}
export type RussianCouncilBallotResult =
  | { outcome: "elected"; validBallots: number; winnerIds: string[]; vacancies: number }
  | {
      outcome: "repeat";
      validBallots: number;
      reason: "invalidated" | "low-valid-turnout" | "no-candidates";
    };

export function resolveRussianCouncilBallot(
  input: RussianCouncilBallotInput
): RussianCouncilBallotResult {
  const counts = [
    input.registeredVoters,
    input.validBallots,
    input.againstAllVotes,
    ...input.options.map((row) => row.votes),
  ];
  if (
    counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
    new Set(input.options.map((row) => row.id)).size !== input.options.length ||
    input.options.some(
      (row) => !row.id || !Number.isSafeInteger(row.registrationOrder) || row.registrationOrder < 0
    )
  )
    throw new Error("Council ballots need unique nominees and safe counts");
  const valid = BigInt(input.validBallots);
  const againstAll = BigInt(input.againstAllVotes);
  const candidateBallots = valid - againstAll;
  const marks = input.options.reduce((sum, row) => sum + BigInt(row.votes), BigInt(0));
  if (
    valid > BigInt(input.registeredVoters) ||
    candidateBallots < BigInt(0) ||
    marks < candidateBallots ||
    marks > candidateBallots * BigInt(2) ||
    input.options.some((row) => BigInt(row.votes) > candidateBallots)
  )
    throw new Error(
      "Council candidate marks must fit one or two distinct choices per valid ballot"
    );
  if (input.invalidated)
    return { outcome: "repeat", validBallots: input.validBallots, reason: "invalidated" };
  if (input.registeredVoters === 0 || valid * BigInt(4) < BigInt(input.registeredVoters))
    return { outcome: "repeat", validBallots: input.validBallots, reason: "low-valid-turnout" };
  const ranked = [...input.options].sort(
    (a, b) =>
      b.votes - a.votes || a.registrationOrder - b.registrationOrder || a.id.localeCompare(b.id)
  );
  if (!ranked.length)
    return { outcome: "repeat", validBallots: input.validBallots, reason: "no-candidates" };
  // Decree 1846 removes the highest-candidate against-all veto, while leaving
  // the second-seat provision in article 31 unchanged. Strict excess vetoes
  // only the second mandate; equality does not.
  const winnerIds = [ranked[0].id];
  if (ranked[1] && input.againstAllVotes <= ranked[1].votes) winnerIds.push(ranked[1].id);
  return {
    outcome: "elected",
    validBallots: input.validBallots,
    winnerIds,
    vacancies: 2 - winnerIds.length,
  };
}
