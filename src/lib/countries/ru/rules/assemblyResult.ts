/**
 * First-Duma ballots require valid votes from at least a quarter of registered voters.
 * resolveRussianDumaList applies the five-percent list gate and exact Hare remainders;
 * resolveRussianDumaConstituency elects the plurality leader with registration-order ties.
 * https://xn--90aiawao7a1fl.xn--80abliecoqdpqeu7c.xn--p1ai/1993/1/
 * https://normativ.kontur.ru/document/1/2553-ukaz-prezidenta-rf-ot-06-11-93-n-1846
 */
export interface RussianDumaVoteOption {
  id: string;
  votes: number;
  registrationOrder: number;
}
interface BallotInput {
  registeredVoters: number;
  options: readonly RussianDumaVoteOption[];
  againstAllVotes: number;
  invalidated?: boolean;
}
type RepeatReason = "invalidated" | "low-valid-turnout" | "no-eligible-list" | "no-candidate-votes";
function validate(input: BallotInput): number {
  const counts = [
    input.registeredVoters,
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
    throw new Error("Russian Duma ballots need unique options and safe vote counts");
  const valid = input.options.reduce(
    (sum, row) => sum + BigInt(row.votes),
    BigInt(input.againstAllVotes)
  );
  if (valid > BigInt(input.registeredVoters))
    throw new Error("Russian Duma votes exceed the frozen register");
  return Number(valid);
}
function failure(input: BallotInput, valid: number): RepeatReason | null {
  if (input.invalidated) return "invalidated";
  if (input.registeredVoters === 0 || BigInt(valid) * BigInt(4) < BigInt(input.registeredVoters))
    return "low-valid-turnout";
  return null;
}
function registrationTie(a: RussianDumaVoteOption, b: RussianDumaVoteOption): number {
  return a.registrationOrder - b.registrationOrder || a.id.localeCompare(b.id);
}

export function resolveRussianDumaList(
  input: BallotInput
):
  | { outcome: "elected"; validBallots: number; partySeats: Record<string, number> }
  | { outcome: "repeat"; validBallots: number; reason: RepeatReason } {
  const valid = validate(input);
  const reason = failure(input, valid);
  if (reason) return { outcome: "repeat", validBallots: valid, reason };
  // Article 38 excludes lists below five percent of valid ballots. Against-all
  // ballots count in that denominator but never receive seats.
  const eligible = input.options.filter(
    (row) => row.votes > 0 && BigInt(row.votes) * BigInt(20) >= BigInt(valid)
  );
  if (!eligible.length)
    return { outcome: "repeat", validBallots: valid, reason: "no-eligible-list" };
  // Decree 1846's amended quota uses votes for admitted lists only.
  const admitted = eligible.reduce((sum, row) => sum + BigInt(row.votes), BigInt(0));
  const rows = eligible.map((row) => {
    const numerator = BigInt(row.votes) * BigInt(225);
    return { ...row, seats: Number(numerator / admitted), remainder: numerator % admitted };
  });
  const remaining = 225 - rows.reduce((sum, row) => sum + row.seats, 0);
  const ranked = [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? b.votes - a.votes || registrationTie(a, b)
      : a.remainder > b.remainder
        ? -1
        : 1
  );
  for (const row of ranked.slice(0, remaining)) row.seats++;
  const assigned = new Map(rows.map((row) => [row.id, row.seats]));
  return {
    outcome: "elected",
    validBallots: valid,
    partySeats: Object.fromEntries(input.options.map((row) => [row.id, assigned.get(row.id) ?? 0])),
  };
}

export function resolveRussianDumaConstituency(
  input: BallotInput
):
  | { outcome: "elected"; validBallots: number; winnerId: string }
  | { outcome: "repeat"; validBallots: number; reason: RepeatReason } {
  const valid = validate(input);
  const reason = failure(input, valid);
  if (reason) return { outcome: "repeat", validBallots: valid, reason };
  const winner = [...input.options].sort((a, b) => b.votes - a.votes || registrationTie(a, b))[0];
  if (!winner || winner.votes === 0)
    return { outcome: "repeat", validBallots: valid, reason: "no-candidate-votes" };
  // Decree 1846 replaced the old against-all veto with the valid-ballot quorum.
  return { outcome: "elected", validBallots: valid, winnerId: winner.id };
}
