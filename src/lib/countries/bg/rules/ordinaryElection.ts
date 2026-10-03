import { BG_ORDINARY_ASSEMBLY_SEATS } from "./assemblyTransition";

/**
 * The 13 October 1991 National Assembly election used closed party lists,
 * D'Hondt divisors and a 4% nationwide party threshold. The game has five
 * macroregions, so these rules operate on five regional races rather than the
 * historical 31 constituencies.
 * https://data.ipu.org/election-summary/PDF/BULGARIA_1991_E.PDF
 */

export interface BgRegionalBallot {
  state: string;
  totalSeats: number;
  status: string;
  votes: Readonly<Record<string, number>>;
  candidateParties: Readonly<Record<string, string>>;
}

/** The 1991 nationwide 4% gate is decided from every regional ballot together. */
export function bgNationwideEligibleParties(
  ballots: readonly BgRegionalBallot[]
): ReadonlySet<string> | null {
  const expectedStates = Object.keys(BG_ORDINARY_ASSEMBLY_SEATS);
  if (
    ballots.length !== expectedStates.length ||
    ballots.some(
      (ballot) =>
        BG_ORDINARY_ASSEMBLY_SEATS[ballot.state] !== ballot.totalSeats ||
        !["completed", "resolved"].includes(ballot.status)
    ) ||
    expectedStates.some((state) => ballots.filter((ballot) => ballot.state === state).length !== 1)
  ) {
    return null;
  }

  const partyVotes = new Map<string, number>();
  let allVotes = 0;
  for (const ballot of ballots) {
    if (Object.keys(ballot.votes).length === 0) return null;
    for (const [candidateId, votes] of Object.entries(ballot.votes)) {
      if (!Number.isFinite(votes) || votes < 0) return null;
      const party = ballot.candidateParties[candidateId];
      if (!party) return null;
      allVotes += votes;
      if (party !== "independent") {
        partyVotes.set(party, (partyVotes.get(party) ?? 0) + votes);
      }
    }
  }
  if (allVotes <= 0) return null;
  return new Set([...partyVotes].filter(([, votes]) => votes / allVotes >= 0.04).map(([id]) => id));
}

export interface BgListCandidate {
  id: string;
  party: string;
  votes: number;
  /** Earlier nomination is the list head; ties use candidate id. */
  listOrder: number;
}

/**
 * Closed-list D'Hondt within one game macroregion. Party votes are pooled;
 * all of a list's seats are carried by its first candidate in this game's
 * multi-seat office model. Independents each stand as a one-person list.
 */
export function bgDhondtSeats(
  candidates: readonly BgListCandidate[],
  totalSeats: number,
  nationwideEligibleParties: ReadonlySet<string>
): Record<string, number> {
  const seats = Object.fromEntries(candidates.map((candidate) => [candidate.id, 0]));
  if (!Number.isInteger(totalSeats) || totalSeats <= 0) return seats;

  const lists = new Map<
    string,
    { votes: number; headId: string; headOrder: number; seats: number }
  >();
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.votes) || candidate.votes <= 0) continue;
    if (candidate.party !== "independent" && !nationwideEligibleParties.has(candidate.party)) {
      continue;
    }
    const key = candidate.party === "independent" ? `independent:${candidate.id}` : candidate.party;
    const current = lists.get(key);
    if (!current) {
      lists.set(key, {
        votes: candidate.votes,
        headId: candidate.id,
        headOrder: candidate.listOrder,
        seats: 0,
      });
    } else {
      current.votes += candidate.votes;
      if (
        candidate.listOrder < current.headOrder ||
        (candidate.listOrder === current.headOrder && candidate.id < current.headId)
      ) {
        current.headId = candidate.id;
        current.headOrder = candidate.listOrder;
      }
    }
  }

  for (let seat = 0; seat < totalSeats; seat++) {
    const ranked = [...lists].sort((a, b) => {
      const quotient = b[1].votes / (b[1].seats + 1) - a[1].votes / (a[1].seats + 1);
      return quotient || b[1].votes - a[1].votes || a[0].localeCompare(b[0]);
    });
    const winner = ranked[0]?.[1];
    if (!winner) break;
    winner.seats++;
  }
  for (const list of lists.values()) seats[list.headId] = list.seats;
  return seats;
}
