/**
 * Portable presidential-general rules.
 *
 * Plain data in, plain data out: the turn shell owns persistence, clocks, and
 * candidate enrichment. Keeping these transforms pure lets the simulation
 * harness exercise the exact rules the live turn uses.
 */

export interface TacticalMovementCandidate {
  id: string;
  economicPosition: number;
  socialPosition: number;
}

export interface TacticalMovementInput {
  /** Newly allocated ballots for this turn only. */
  turnVotes: Record<string, number>;
  /** Cumulative ballots before this turn, used to determine local viability. */
  priorVotes: Record<string, number>;
  /** Active, non-suspended candidates eligible to receive new ballots. */
  candidates: TacticalMovementCandidate[];
  /** Fraction of a locally nonviable candidate's new ballots that move. */
  movementRate: number;
}

function finiteOrUndefined(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Blend national and state approval for the presidential incumbency driver.
 * Missing inputs degrade to the value that exists; neither missing returns
 * undefined so the downstream driver keeps its established neutral fallback.
 */
export function blendIncumbentApproval(
  nationalApproval: number | null | undefined,
  stateApproval: number | null | undefined,
  stateWeight: number
): number | undefined {
  const national = finiteOrUndefined(nationalApproval);
  const state = finiteOrUndefined(stateApproval);
  if (national === undefined) return state;
  if (state === undefined) return national;
  const weight = Math.min(1, Math.max(0, finiteOrUndefined(stateWeight) ?? 0));
  return national * (1 - weight) + state * weight;
}

/** True during the ramp plus final election-day bands. */
export function isClosingVotingTurn(
  totalTurns: number,
  turnIndex: number,
  rampTurns: number,
  finalTurns: number
): boolean {
  if (totalTurns <= 0 || turnIndex < 0 || turnIndex >= totalTurns) return false;
  const closingTurns = Math.max(0, rampTurns) + Math.max(0, finalTurns);
  return turnIndex >= Math.max(0, totalTurns - closingTurns);
}

function ideologicalDistance(a: TacticalMovementCandidate, b: TacticalMovementCandidate): number {
  return (
    Math.abs(a.economicPosition - b.economicPosition) +
    Math.abs(a.socialPosition - b.socialPosition)
  );
}

/**
 * Move a bounded share of NEW closing-period ballots from candidates outside
 * the local top two to the ideologically nearest locally viable candidate.
 *
 * Prior ballots are never rewritten. A unit with no prior result, fewer than
 * three active candidates, or no transferable ballots is an identity. Ties in
 * ideological distance split deterministically and vote totals are conserved.
 */
export function applyTacticalMovement(input: TacticalMovementInput): Record<string, number> {
  const out = Object.fromEntries(
    Object.entries(input.turnVotes).map(([id, votes]) => [
      id,
      Number.isFinite(votes) ? Math.max(0, Math.round(votes)) : 0,
    ])
  );
  const rate = Math.min(1, Math.max(0, finiteOrUndefined(input.movementRate) ?? 0));
  if (rate === 0 || input.candidates.length < 3) return out;

  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const ranked = input.candidates
    .map((candidate) => ({
      candidate,
      votes: Math.max(0, finiteOrUndefined(input.priorVotes[candidate.id]) ?? 0),
    }))
    .sort((a, b) => b.votes - a.votes || a.candidate.id.localeCompare(b.candidate.id));
  if (ranked.reduce((sum, row) => sum + row.votes, 0) <= 0) return out;

  const viable = ranked.slice(0, 2).map((row) => row.candidate);
  const viableIds = new Set(viable.map((candidate) => candidate.id));
  for (const candidate of input.candidates) {
    if (viableIds.has(candidate.id)) continue;
    const available = out[candidate.id] ?? 0;
    const moved = Math.min(available, Math.round(available * rate));
    if (moved <= 0) continue;

    const firstDistance = ideologicalDistance(candidate, viable[0]);
    const secondDistance = ideologicalDistance(candidate, viable[1]);
    out[candidate.id] = available - moved;
    if (firstDistance === secondDistance) {
      const firstShare = Math.floor(moved / 2);
      out[viable[0].id] = (out[viable[0].id] ?? 0) + firstShare;
      out[viable[1].id] = (out[viable[1].id] ?? 0) + moved - firstShare;
    } else {
      const recipient = firstDistance < secondDistance ? viable[0] : viable[1];
      out[recipient.id] = (out[recipient.id] ?? 0) + moved;
    }
  }

  // Preserve zero rows for eligible candidates omitted from turnVotes.
  for (const id of byId.keys()) out[id] ??= 0;
  return out;
}
