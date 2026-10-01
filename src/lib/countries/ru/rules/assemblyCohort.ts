/**
 * First-Duma certification resolves both electoral tiers before assigning list mandates.
 * resolveRussianDumaCohort records failed constituencies as vacancies, requires the
 * complete frozen ballot map and keeps constituency winners out of player list seats.
 */
import { planRussianDumaDistricts } from "./assemblyDistricts";
import { allocateRussianDumaListMandates } from "./assemblyList";
import { resolveRussianDumaConstituency, resolveRussianDumaList } from "./assemblyResult";

export interface RussianDumaCohortCandidate {
  id: string;
  ownerId: string;
  party: string;
  votes: number;
  registrationOrder: number;
  nominationOrder: number;
  isNpc: boolean;
  capacity: number;
  /** Loaded owner existence, residence, retirement and candidacy eligibility. */
  eligible: boolean;
}
export interface RussianDumaCohortBallot {
  id: string;
  seatId: string;
  regionId: string;
  tier: "constituency" | "list";
  registeredVoters: number;
  againstAllVotes: number;
  invalidated?: boolean;
  candidates: readonly RussianDumaCohortCandidate[];
}

export function resolveRussianDumaCohort(ballots: readonly RussianDumaCohortBallot[]) {
  if (
    ballots.length !== 226 ||
    new Set(ballots.map((row) => row.id)).size !== 226 ||
    new Set(ballots.map((row) => row.seatId)).size !== 226 ||
    ballots.some(
      (row) => !row.id || !Number.isSafeInteger(row.registeredVoters) || row.registeredVoters < 0
    )
  )
    throw new Error("First-Duma certification needs 226 unique safe ballots");
  const lists = ballots.filter((row) => row.tier === "list");
  const districts = ballots.filter((row) => row.tier === "constituency");
  if (
    lists.length !== 1 ||
    districts.length !== 225 ||
    lists[0].seatId !== "RU-duma-national-list" ||
    lists[0].regionId !== "RU"
  )
    throw new Error("First-Duma certification needs both complete electoral tiers");
  const register: Record<string, number> = {};
  for (const district of districts) {
    const total = BigInt(register[district.regionId] ?? 0) + BigInt(district.registeredVoters);
    if (total > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("District registration exceeds precision");
    register[district.regionId] = Number(total);
  }
  const expected = new Map(planRussianDumaDistricts(register).map((row) => [row.seatId, row]));
  if (
    districts.some(
      (row) =>
        expected.get(row.seatId)?.regionId !== row.regionId ||
        expected.get(row.seatId)?.registeredVoters !== row.registeredVoters
    ) ||
    Object.values(register).reduce((sum, voters) => sum + BigInt(voters), BigInt(0)) !==
      BigInt(lists[0].registeredVoters)
  )
    throw new Error("The first-Duma cohort has inconsistent frozen registration");
  const allCandidates = ballots.flatMap((row) => [...row.candidates]);
  if (
    new Set(allCandidates.map((row) => row.id)).size !== allCandidates.length ||
    allCandidates.some(
      (row) =>
        !row.id ||
        !row.ownerId ||
        !row.party ||
        typeof row.isNpc !== "boolean" ||
        typeof row.eligible !== "boolean" ||
        !Number.isSafeInteger(row.nominationOrder) ||
        row.nominationOrder < 0 ||
        !Number.isSafeInteger(row.capacity) ||
        row.capacity < 1 ||
        row.capacity > 225 ||
        (!row.isNpc && row.capacity !== 1)
    )
  )
    throw new Error("Duma nominees need unique candidacies, owners and bounded capacities");
  const districtPlayers = districts.flatMap((row) =>
    row.candidates.filter((candidate) => !candidate.isNpc).map((candidate) => candidate.ownerId)
  );
  if (new Set(districtPlayers).size !== districtPlayers.length)
    throw new Error("A player cannot contest multiple Duma constituencies");
  const list = lists[0];
  if (districts.some((ballot) => ballot.candidates.some((row) => row.capacity !== 1)))
    throw new Error("A Duma constituency nominee can contest only one seat");
  if (list.candidates.some((row) => row.party === "independent"))
    throw new Error("Independent Duma candidates must contest constituencies, not party lists");
  if (new Set(list.candidates.map((row) => row.ownerId)).size !== list.candidates.length)
    throw new Error("An owner cannot occupy multiple Duma list nominations");
  const playerWinners = new Set<string>();
  const constituencyResults = [...districts]
    .sort((a, b) => a.seatId.localeCompare(b.seatId))
    .map((ballot) => {
      const decision = resolveRussianDumaConstituency({
        registeredVoters: ballot.registeredVoters,
        options: ballot.candidates.map((row) => ({
          id: row.id,
          votes: row.votes,
          registrationOrder: row.registrationOrder,
        })),
        againstAllVotes: ballot.againstAllVotes,
        invalidated: ballot.invalidated,
      });
      if (decision.outcome !== "elected")
        return {
          electionId: ballot.id,
          seatId: ballot.seatId,
          regionId: ballot.regionId,
          decision,
          winner: null,
        };
      const winner = ballot.candidates.find((row) => row.id === decision.winnerId)!;
      if (!winner.eligible)
        return {
          electionId: ballot.id,
          seatId: ballot.seatId,
          regionId: ballot.regionId,
          decision: {
            outcome: "repeat" as const,
            validBallots: decision.validBallots,
            reason: "ineligible-winner" as const,
          },
          winner: null,
        };
      if (!winner.isNpc) playerWinners.add(winner.ownerId);
      return {
        electionId: ballot.id,
        seatId: ballot.seatId,
        regionId: ballot.regionId,
        decision,
        winner,
      };
    });
  const partyVotes = new Map<string, { id: string; votes: number; registrationOrder: number }>();
  for (const candidate of list.candidates) {
    if (
      !Number.isSafeInteger(candidate.votes) ||
      candidate.votes < 0 ||
      !Number.isSafeInteger(candidate.registrationOrder) ||
      candidate.registrationOrder < 0
    )
      throw new Error("Invalid Duma list candidate votes or registration");
    const old = partyVotes.get(candidate.party);
    const votes = BigInt(old?.votes ?? 0) + BigInt(candidate.votes);
    if (votes > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Duma party votes exceed precision");
    partyVotes.set(candidate.party, {
      id: candidate.party,
      votes: Number(votes),
      registrationOrder: Math.min(
        old?.registrationOrder ?? candidate.registrationOrder,
        candidate.registrationOrder
      ),
    });
  }
  const listDecision = resolveRussianDumaList({
    registeredVoters: list.registeredVoters,
    againstAllVotes: list.againstAllVotes,
    invalidated: list.invalidated,
    options: [...partyVotes.values()],
  });
  const listAssignment =
    listDecision.outcome === "elected"
      ? allocateRussianDumaListMandates({
          partySeats: listDecision.partySeats,
          nominees: list.candidates
            .filter((row) => row.eligible)
            .map((row) => ({
              id: row.id,
              party: row.party,
              order: row.nominationOrder,
              isNpc: row.isNpc,
              capacity: row.capacity,
              constituencyWinner: !row.isNpc && playerWinners.has(row.ownerId),
            })),
        })
      : null;
  return { constituencyResults, listElectionId: list.id, listDecision, listAssignment };
}
