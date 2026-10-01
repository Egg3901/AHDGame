/**
 * Duma votes retain counted withdrawals and stay within the frozen electoral register.
 * russianDumaVoteTotals caps this turn's increments with exact remainder allocation;
 * campaigns add no separate multiplier to this legislative ballot.
 */
import { russianPresidentialVoteIncrement } from "./presidentialVoteIncrement";

export function russianDumaVoteTotals(input: {
  registeredVoters: number;
  againstAllVotes?: number;
  priorVotes: Readonly<Record<string, number>>;
  rawVotes: Readonly<Record<string, number>>;
}): Record<string, number> {
  const againstAll = input.againstAllVotes ?? 0;
  if (!Number.isSafeInteger(againstAll) || againstAll < 0 || againstAll > input.registeredVoters)
    throw new Error("Duma against-all votes exceed the frozen register");
  const increments = russianPresidentialVoteIncrement({
    ...input,
    registeredVoters: input.registeredVoters - againstAll,
    campaignStrength: {},
  });
  const totals = { ...input.priorVotes };
  for (const [id, increment] of Object.entries(increments))
    totals[id] = (totals[id] ?? 0) + increment;
  return totals;
}
