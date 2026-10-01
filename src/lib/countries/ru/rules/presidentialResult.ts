/**
 * Russia's first direct presidency needs a popular majority and 50 percent turnout.
 * decideRussianPresidentialResult sends a failed multi-candidate first round to
 * two finalists and requires a fresh ballot instead of awarding the first-round leader.
 */
export interface RussianPresidentialBallot {
  round: 1 | 2;
  candidateIds: readonly string[];
  votesFor: Readonly<Record<string, number>>;
  votesAgainst: Readonly<Record<string, number>>;
  registeredVoters: number;
  participants: number;
  /** A withdrawn or otherwise ineligible registered candidate invalidates this ballot. */
  invalidated?: boolean;
}
export type RussianPresidentialResult =
  | { outcome: "won"; winnerCandidateId: string }
  | { outcome: "runoff"; finalistCandidateIds: [string, string] }
  | {
      outcome: "repeat";
      reason:
        | "low-turnout"
        | "no-majority"
        | "tied-finalists"
        | "no-runoff-winner"
        | "invalid-ballot"
        | "no-candidates";
    };

/** Law 1096-1 of 24 April 1991, articles 15-17. The runoff also needs more
 * votes for its winner than against that candidate. Blank/invalid ballots
 * remain in participation; they cannot be dropped to manufacture a majority.
 * https://www.consultant.ru/document/cons_doc_LAW_64/59cdae85dcd9654cb523acdc0c8e700f983324b1/
 */
export function decideRussianPresidentialResult(
  ballot: RussianPresidentialBallot
): RussianPresidentialResult {
  const { candidateIds, votesFor, votesAgainst, registeredVoters, participants, round } = ballot;
  if (
    (round !== 1 && round !== 2) ||
    new Set(candidateIds).size !== candidateIds.length ||
    candidateIds.some((id) => !id) ||
    (round === 2 && candidateIds.length !== 2 && candidateIds.length !== 0) ||
    !Number.isSafeInteger(registeredVoters) ||
    registeredVoters < 1 ||
    !Number.isSafeInteger(participants) ||
    participants < 0 ||
    participants > registeredVoters
  )
    throw new Error("Invalid Russian presidential ballot");
  const ids = [...candidateIds].sort();
  for (const counts of [votesFor, votesAgainst]) {
    if (
      Object.keys(counts).sort().join("\u0000") !== ids.join("\u0000") ||
      ids.some(
        (id) => !Number.isSafeInteger(counts[id]) || counts[id] < 0 || counts[id] > participants
      )
    )
      throw new Error("Russian presidential ballot needs a valid count for every candidate");
  }
  const totalFor = ids.reduce((sum, id) => sum + BigInt(votesFor[id]), BigInt(0));
  if (
    totalFor > BigInt(participants) ||
    ids.some((id) => BigInt(votesFor[id]) + BigInt(votesAgainst[id]) > BigInt(participants))
  )
    throw new Error("Russian presidential counts exceed participation");
  if (!ids.length && participants === 0) return { outcome: "repeat", reason: "no-candidates" };
  if (ballot.invalidated) return { outcome: "repeat", reason: "invalid-ballot" };
  if (BigInt(participants) * BigInt(2) < BigInt(registeredVoters))
    return { outcome: "repeat", reason: "low-turnout" };
  const ranked = [...ids].sort((a, b) => votesFor[b] - votesFor[a] || a.localeCompare(b));
  if (round === 1) {
    if (BigInt(votesFor[ranked[0]]) * BigInt(2) > BigInt(participants))
      return { outcome: "won", winnerCandidateId: ranked[0] };
    if (ranked.length < 3) return { outcome: "repeat", reason: "no-majority" };
    if (votesFor[ranked[1]] === votesFor[ranked[2]])
      return { outcome: "repeat", reason: "tied-finalists" };
    return { outcome: "runoff", finalistCandidateIds: [ranked[0], ranked[1]] };
  }
  if (votesFor[ranked[0]] > votesFor[ranked[1]] && votesFor[ranked[0]] > votesAgainst[ranked[0]])
    return { outcome: "won", winnerCandidateId: ranked[0] };
  return { outcome: "repeat", reason: "no-runoff-winner" };
}
