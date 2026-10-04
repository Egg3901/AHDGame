/**
 * Russian party-list mandates must fit the nominated candidates' capacity.
 * allocateRussianDumaListMandates keeps each player to one legislative seat,
 * excludes constituency winners and represents remaining individuals with NPC slates.
 */
export interface RussianDumaListNominee {
  id: string;
  party: string;
  order: number;
  isNpc: boolean;
  capacity: number;
  /** A player who wins a constituency cannot also hold a list mandate. */
  constituencyWinner?: boolean;
}

export function allocateRussianDumaListMandates(input: {
  partySeats: Readonly<Record<string, number>>;
  nominees: readonly RussianDumaListNominee[];
}): { seatsByNominee: Record<string, number>; vacanciesByParty: Record<string, number> } {
  const parties = Object.entries(input.partySeats);
  if (
    parties.some(
      ([party, seats]) => !party || !Number.isSafeInteger(seats) || seats < 0 || seats > 225
    ) ||
    parties.reduce((sum, [, seats]) => sum + seats, 0) !== 225
  )
    throw new Error("The Duma list tier must award exactly 225 safe mandates");
  if (
    new Set(input.nominees.map((candidate) => candidate.id)).size !== input.nominees.length ||
    input.nominees.some(
      (candidate) =>
        !candidate.id ||
        !candidate.party ||
        !Number.isSafeInteger(candidate.order) ||
        candidate.order < 0 ||
        !Number.isSafeInteger(candidate.capacity) ||
        candidate.capacity < 1 ||
        candidate.capacity > 225 ||
        (!candidate.isNpc && candidate.capacity !== 1)
    )
  )
    throw new Error("Duma list nominees need unique identities and bounded seat capacity");
  const seatsByNominee = Object.fromEntries(input.nominees.map((candidate) => [candidate.id, 0]));
  const vacanciesByParty: Record<string, number> = {};
  for (const [party, awarded] of parties) {
    let remaining = awarded;
    const roster = input.nominees
      .filter((candidate) => candidate.party === party)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    for (const nominee of roster) {
      if (!nominee.isNpc && nominee.constituencyWinner) continue;
      const seats = Math.min(remaining, nominee.capacity);
      seatsByNominee[nominee.id] = seats;
      remaining -= seats;
    }
    vacanciesByParty[party] = remaining;
  }
  return { seatsByNominee, vacanciesByParty };
}
