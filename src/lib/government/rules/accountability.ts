/** Government responsibility follows parties in office, surviving a new nominee. */
export interface ResponsibilityInput {
  executiveParty: string | null;
  coalitionParties?: string[];
  seatsByParty: Record<string, number>;
  chamberSize: number;
}

export function responsibilityShares(input: ResponsibilityInput): Record<string, number> {
  const shares: Record<string, number> = {};
  const partners = [...new Set([input.executiveParty, ...(input.coalitionParties ?? [])])].filter(
    (party): party is string => !!party
  );
  const support = partners.reduce((sum, party) => sum + (input.seatsByParty[party] ?? 0), 0);
  for (const party of partners) {
    shares[party] =
      0.75 * (support > 0 ? (input.seatsByParty[party] ?? 0) / support : 1 / partners.length);
  }
  if (input.chamberSize > 0) {
    for (const [party, seats] of Object.entries(input.seatsByParty)) {
      if (seats > input.chamberSize / 2) shares[party] = (shares[party] ?? 0) + 0.25;
    }
  }
  return shares;
}

export function accountabilityDrain(
  approval: number,
  responsibility: number,
  tenureTurns: number
): number {
  if (!Number.isFinite(approval) || approval >= 50) return 0;
  // Four game years earn no fatigue; continued poor government then adds up to
  // one further performance cost over the following twelve game years.
  const fatigue = 1 + Math.max(0, Math.min(1, (tenureTurns - 192) / 576));
  return Math.min(
    0.25,
    ((50 - Math.max(0, approval)) / 200) * Math.max(0, Math.min(1, responsibility)) * fatigue
  );
}

export function continuingPartySinceTurn(
  previous: { sinceTurn: number; lastObservedTurn: number } | undefined,
  turn: number
): number {
  return previous && previous.lastObservedTurn >= turn - 1
    ? Math.min(previous.sinceTurn, turn)
    : turn;
}

/** No registration advantage for an executive below neutral approval. */
export function earnedOfficeholdingBonus(approval: number | undefined): number {
  return approval != null && Number.isFinite(approval)
    ? Math.max(0, Math.min(1, (approval - 50) / 20))
    : 0;
}

/** Executive re-election drag responds continuously all the way to zero approval. */
export function executiveIncumbencyBudget(approval: number | undefined, pivot = 46): number {
  if (approval == null || !Number.isFinite(approval)) return 0.1;
  const value = Math.max(0, Math.min(100, approval));
  if (value >= pivot) return Math.min(0.1, (value - pivot) * 0.01);
  const shortfall = pivot - value;
  return -Math.min(
    0.2,
    Math.min(0.1, shortfall * 0.01) + (0.1 * Math.max(0, shortfall - 10)) / Math.max(1, pivot - 10)
  );
}
