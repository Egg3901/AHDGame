/** The 2014 Hungarian Assembly ballot has two independent vote streams. */
export const HU_CONSTITUENCY_SEATS = 106;
export const HU_LIST_SEATS = 93;

export interface ConstituencyBallot {
  id: string;
  votes: ReadonlyArray<{ partyId: string; votes: number }>;
}

export interface PartyListBallot {
  partyId: string;
  votes: number;
  /** A joint list of two parties needs 10%; three or more need 15%. */
  memberParties?: number;
}

export interface HungaryMixedResult {
  constituencySeats: Record<string, number>;
  listSeats: Record<string, number>;
  totalSeats: Record<string, number>;
  compensationVotes: Record<string, number>;
}

/**
 * Allocate the party mandates from separate constituency and national-list
 * ballots. Losing candidates' votes and each winner's surplus over the runner
 * up flow into the national list before D'Hondt. National minority lists have
 * their own preferential rule and are outside this party-list calculation.
 *
 * https://www.valasztas.hu/en/altalanos-tajekoztato-az-orszaggyulesi-kepviselok-valasztasarol
 */
export function allocateHungaryMixed2014(
  constituencies: ReadonlyArray<ConstituencyBallot>,
  partyLists: ReadonlyArray<PartyListBallot>
): HungaryMixedResult {
  if (constituencies.length !== HU_CONSTITUENCY_SEATS) {
    throw new Error(`Hungary requires ${HU_CONSTITUENCY_SEATS} constituency results`);
  }
  const ids = new Set<string>();
  const constituencySeats: Record<string, number> = {};
  const compensationVotes: Record<string, number> = {};
  for (const constituency of constituencies) {
    if (!constituency.id || ids.has(constituency.id) || constituency.votes.length === 0) {
      throw new Error("Hungary constituency IDs must be unique and have votes");
    }
    ids.add(constituency.id);
    const ballotParties = new Set<string>();
    const ranked = [...constituency.votes].sort(
      (a, b) => b.votes - a.votes || a.partyId.localeCompare(b.partyId)
    );
    for (const vote of ranked) {
      if (
        !vote.partyId ||
        ballotParties.has(vote.partyId) ||
        !Number.isSafeInteger(vote.votes) ||
        vote.votes < 0
      ) {
        throw new Error("Invalid Hungarian constituency vote");
      }
      ballotParties.add(vote.partyId);
    }
    if (ranked[0].votes === 0) throw new Error("Hungarian constituency has no valid votes");
    const winner = ranked[0];
    constituencySeats[winner.partyId] = (constituencySeats[winner.partyId] ?? 0) + 1;
    // One vote more than the runner-up is needed to win; the rest is surplus.
    compensationVotes[winner.partyId] =
      (compensationVotes[winner.partyId] ?? 0) +
      Math.max(0, winner.votes - (ranked[1]?.votes ?? 0) - 1);
    for (const loser of ranked.slice(1)) {
      compensationVotes[loser.partyId] = (compensationVotes[loser.partyId] ?? 0) + loser.votes;
    }
  }

  const listIds = new Set<string>();
  const validLists = partyLists.map((list) => {
    if (
      !list.partyId ||
      listIds.has(list.partyId) ||
      !Number.isSafeInteger(list.votes) ||
      list.votes < 0 ||
      !Number.isSafeInteger(list.memberParties ?? 1) ||
      (list.memberParties ?? 1) < 1
    ) {
      throw new Error("Invalid Hungarian national list vote");
    }
    listIds.add(list.partyId);
    return list;
  });
  const totalListVotes = validLists.reduce((sum, list) => sum + list.votes, 0);
  if (totalListVotes === 0) throw new Error("Hungarian national list has no valid votes");
  const eligible = validLists
    .filter((list) => {
      const threshold =
        list.memberParties === undefined || list.memberParties === 1
          ? 0.05
          : list.memberParties === 2
            ? 0.1
            : 0.15;
      // Eligibility is calculated from list votes before compensation.
      return list.votes / totalListVotes >= threshold;
    })
    .map((list) => ({
      partyId: list.partyId,
      votes: list.votes + (compensationVotes[list.partyId] ?? 0),
    }));
  if (eligible.length === 0) throw new Error("No Hungarian national list reached the threshold");

  const listSeats: Record<string, number> = {};
  for (let seat = 0; seat < HU_LIST_SEATS; seat++) {
    const best = [...eligible].sort((a, b) => {
      // Cross multiply to avoid floating point quotient ties.
      const aQuotient = a.votes * ((listSeats[b.partyId] ?? 0) + 1);
      const bQuotient = b.votes * ((listSeats[a.partyId] ?? 0) + 1);
      return bQuotient - aQuotient || a.partyId.localeCompare(b.partyId);
    })[0];
    listSeats[best.partyId] = (listSeats[best.partyId] ?? 0) + 1;
  }
  const totalSeats = { ...constituencySeats };
  for (const [partyId, seats] of Object.entries(listSeats)) {
    totalSeats[partyId] = (totalSeats[partyId] ?? 0) + seats;
  }
  return { constituencySeats, listSeats, totalSeats, compensationVotes };
}
