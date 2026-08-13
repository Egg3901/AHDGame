/**
 * Pick the candidates to show once an election has left its primary phase.
 *
 * Keeps up to `maxPerParty` candidates per party, highest primary score first —
 * the display-side mirror of the elimination the turn resolver performs in
 * `resolvePrimariesIfNeeded`. It doubles as a safety net for the window between
 * `primaryEndTime` and the next primary-resolution turn, when the losing
 * candidacies are still `status: "active"` in the database.
 *
 * `maxPerParty` MUST come from `getPrimaryWinnersForElection(countryId,
 * electionType)` rather than a local constant. Hard-coding it is what caused
 * ticket-1041: the display surfaces capped at one while the turn resolver
 * advanced three, so a player who won their primary appeared to be their
 * party's sole nominee and was blindsided when co-nominees took seats in the
 * general.
 *
 * The viewer's own candidate is always kept, even when they placed below the
 * cap, so a primary loser can still find their own row on the race page.
 */
export function selectGeneralPhaseDisplayCandidates<
  T extends { id: string; party: string; primaryScore: number; isYou?: boolean },
>(enriched: T[], maxPerParty: number): T[] {
  const partyCount = new Map<string, number>();
  const selected: T[] = [];

  for (const c of [...enriched].sort((a, b) => b.primaryScore - a.primaryScore)) {
    const used = partyCount.get(c.party) ?? 0;
    if (used < maxPerParty) {
      selected.push(c);
      partyCount.set(c.party, used + 1);
    }
  }

  const mine = enriched.find((c) => c.isYou);
  if (mine && !selected.some((c) => c.id === mine.id)) {
    selected.push(mine);
  }

  return selected;
}
