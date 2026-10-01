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
  return resolveRussianDumaBallots(ballots, false);
}

/** Repeat generations may have different registers from already certified ballots. */
function resolveRussianDumaBallots(ballots: readonly RussianDumaCohortBallot[], repeat: boolean) {
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
  const boundaryRegister = repeat
    ? Object.fromEntries(Object.keys(register).map((region) => [region, 1]))
    : register;
  const expected = new Map(
    planRussianDumaDistricts(boundaryRegister).map((row) => [row.seatId, row])
  );
  if (
    districts.some(
      (row) =>
        expected.get(row.seatId)?.regionId !== row.regionId ||
        (!repeat && expected.get(row.seatId)?.registeredVoters !== row.registeredVoters)
    ) ||
    (!repeat &&
      Object.values(register).reduce((sum, voters) => sum + BigInt(voters), BigInt(0)) !==
        BigInt(lists[0].registeredVoters))
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
  if (!repeat && new Set(districtPlayers).size !== districtPlayers.length)
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
  const winners = constituencyResults
    .filter((row) => row.winner && !row.winner.isNpc)
    .map((row) => row.winner!.ownerId);
  if (new Set(winners).size !== winners.length)
    throw new Error("A player cannot hold multiple Duma constituency mandates");
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

/** Select failed ballots from a certified board without reopening successful seats. */
export function pendingRussianDumaRepeatBallots(ballots: readonly RussianDumaCohortBallot[]) {
  const result = resolveRussianDumaBallots(ballots, true);
  const pending = new Set(
    result.constituencyResults.filter((row) => !row.winner).map((row) => row.seatId)
  );
  if (result.listDecision.outcome === "repeat") pending.add("RU-duma-national-list");
  return ballots.filter((row) => pending.has(row.seatId));
}

/**
 * Repeat only the failed ballots, retaining each successful constituency unchanged.
 * A new national list or district freezes its own register; list assignments are
 * recalculated against all current constituency winners to keep each player to one seat.
 */
export function resolveRussianDumaRepeatGeneration(input: {
  previousBallots: readonly RussianDumaCohortBallot[];
  replacements: readonly RussianDumaCohortBallot[];
}) {
  const previous = resolveRussianDumaBallots(input.previousBallots, true);
  const pending = new Set(
    previous.constituencyResults.filter((row) => !row.winner).map((row) => row.seatId)
  );
  if (previous.listDecision.outcome === "repeat") pending.add("RU-duma-national-list");
  if (
    !pending.size ||
    input.replacements.length !== pending.size ||
    new Set(input.replacements.map((row) => row.seatId)).size !== pending.size ||
    input.replacements.some((row) => !pending.has(row.seatId))
  )
    throw new Error("Duma repeats must replace exactly the failed ballot set");
  const oldBySeat = new Map(input.previousBallots.map((row) => [row.seatId, row]));
  const oldElectionIds = new Set(input.previousBallots.map((row) => row.id));
  const oldCandidateIds = new Set(
    input.previousBallots.flatMap((row) => row.candidates.map((c) => c.id))
  );
  if (
    input.replacements.some((row) => {
      const old = oldBySeat.get(row.seatId);
      return (
        !old ||
        old.tier !== row.tier ||
        old.regionId !== row.regionId ||
        oldElectionIds.has(row.id) ||
        row.candidates.some((c) => oldCandidateIds.has(c.id))
      );
    })
  )
    throw new Error("Duma repeats need new identities in their original ballot territories");
  const protectedPlayers = new Set(
    previous.constituencyResults
      .filter((row) => row.winner && !row.winner.isNpc)
      .map((row) => row.winner!.ownerId)
  );
  const playerNominees = input.replacements
    .filter((row) => row.tier === "constituency")
    .flatMap((row) => row.candidates.filter((c) => !c.isNpc && c.eligible).map((c) => c.ownerId));
  if (
    new Set(playerNominees).size !== playerNominees.length ||
    playerNominees.some((id) => protectedPlayers.has(id))
  )
    throw new Error("A player cannot contest a repeat while holding another constituency mandate");
  const replacementsBySeat = new Map(input.replacements.map((row) => [row.seatId, row]));
  const ballots = input.previousBallots.map((row) => replacementsBySeat.get(row.seatId) ?? row);
  return { ballots, result: resolveRussianDumaBallots(ballots, true) };
}
