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

export interface MinorityListBallot {
  minorityId: string;
  votes: number;
}

export interface HungaryMixedResult {
  constituencySeats: Record<string, number>;
  listSeats: Record<string, number>;
  totalSeats: Record<string, number>;
  compensationVotes: Record<string, number>;
  minoritySeats: Record<string, number>;
}

/**
 * Allocate the party mandates from separate constituency and national-list
 * ballots. Losing candidates' votes and each winner's surplus over the runner
 * up flow into the national list before D'Hondt. Minority lists first receive
 * their statutory preferential seat and may then compete for further seats.
 *
 * https://portal-api.valasztas.hu/files/6960fa637e5bb300028ca9df/2011-203-00-00.pdf
 */
export function allocateHungaryMixed2014(
  constituencies: ReadonlyArray<ConstituencyBallot>,
  partyLists: ReadonlyArray<PartyListBallot>,
  minorityLists: ReadonlyArray<MinorityListBallot> = []
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
    // A tied plurality elects nobody. Every ballot becomes a wasted vote and
    // the mandate waits for a constituency by-election (Act CCIII §§15, 19).
    if (ranked[1]?.votes === ranked[0].votes) {
      for (const vote of ranked) {
        compensationVotes[vote.partyId] = (compensationVotes[vote.partyId] ?? 0) + vote.votes;
      }
      continue;
    }
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
  const minorityIds = new Set<string>();
  for (const list of minorityLists) {
    if (
      !list.minorityId ||
      listIds.has(list.minorityId) ||
      minorityIds.has(list.minorityId) ||
      !Number.isSafeInteger(list.votes) ||
      list.votes < 0
    ) {
      throw new Error("Invalid Hungarian minority list vote");
    }
    minorityIds.add(list.minorityId);
  }
  const totalListVotes =
    validLists.reduce((sum, list) => sum + list.votes, 0) +
    minorityLists.reduce((sum, list) => sum + list.votes, 0);
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
  const adjustedPartyVotes = eligible.reduce((sum, list) => sum + list.votes, 0);
  const preferentialQuota = Math.floor(
    (adjustedPartyVotes + minorityLists.reduce((sum, list) => sum + list.votes, 0)) /
      HU_LIST_SEATS /
      4
  );
  const minoritySeats: Record<string, number> = {};
  for (const list of minorityLists) {
    if (list.votes > 0 && list.votes >= preferentialQuota) minoritySeats[list.minorityId] = 1;
  }
  const remainingSeats = HU_LIST_SEATS - Object.keys(minoritySeats).length;
  const eligibleMinorities = minorityLists
    .filter((list) => minoritySeats[list.minorityId] && list.votes / totalListVotes >= 0.05)
    .map((list) => ({ partyId: list.minorityId, votes: list.votes - preferentialQuota }));
  const divisorLists = [...eligible, ...eligibleMinorities];
  if (remainingSeats > 0 && divisorLists.length === 0) {
    throw new Error("No Hungarian national list reached the threshold");
  }

  const listSeats: Record<string, number> = {};
  for (let seat = 0; seat < remainingSeats; seat++) {
    const best = [...divisorLists].sort((a, b) => {
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
  for (const [minorityId, seats] of Object.entries(minoritySeats)) {
    totalSeats[minorityId] = (totalSeats[minorityId] ?? 0) + seats;
  }
  return { constituencySeats, listSeats, totalSeats, compensationVotes, minoritySeats };
}
