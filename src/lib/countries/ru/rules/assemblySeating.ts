/**
 * Joint Assembly seating preserves certified individual mandates and lawful vacancies.
 * planRussianAssemblySeating recomputes both frozen families, checks nominee ownership
 * and keeps player and NPC profile identities out of conflicting chamber mandates.
 */
import {
  resolveRussianDumaCohort,
  resolveRussianDumaAccumulatedCohort,
  type RussianDumaCohortBallot,
} from "./assemblyCohort";
import {
  resolveRussianCouncilCohort,
  resolveRussianCouncilAccumulatedCohort,
  type RussianCouncilCohortBallot,
} from "./councilCohort";
export interface RussianAssemblySeatingNominee {
  candidateId: string;
  ownerId: string;
  isNpc: boolean;
  name: string;
  party: string;
}
export interface RussianAssemblySeat {
  candidateId: string;
  ownerId: string;
  isNpc: boolean;
  name: string;
  party: string;
  officeType: "dumaDeputy" | "federationCouncilMember";
  state: string;
  seatId: string;
  electionId: string;
  seatsHeld: number;
  seatSource: "direct" | "list";
}
export function planRussianAssemblySeating(input: {
  duma: {
    generation?: number;
    ballots: readonly RussianDumaCohortBallot[];
    nominees: readonly RussianAssemblySeatingNominee[];
  };
  council: {
    generation?: number;
    ballots: readonly RussianCouncilCohortBallot[];
    nominees: readonly RussianAssemblySeatingNominee[];
  };
}) {
  for (const family of [input.duma, input.council])
    if (!Number.isSafeInteger(family.generation ?? 0) || (family.generation ?? 0) < 0)
      throw new Error("Assembly seating needs a safe certified generation");
  const council = input.council.generation
    ? resolveRussianCouncilAccumulatedCohort(input.council.ballots)
    : resolveRussianCouncilCohort(input.council.ballots);
  const councilNominees = roster(input.council);
  const seats: RussianAssemblySeat[] = [...planRussianDumaSeating(input.duma).seats];
  for (const district of council)
    for (const winner of district.winners) {
      const nominee = councilNominees.get(winner.id)!;
      seats.push({
        ...nominee,
        officeType: "federationCouncilMember",
        state: district.regionId,
        seatId: district.seatId,
        electionId: district.electionId,
        seatsHeld: 1,
        seatSource: "direct",
      });
    }
  const playerSeats = seats.filter((row) => !row.isNpc);
  if (
    playerSeats.some((row) => row.seatsHeld !== 1) ||
    new Set(playerSeats.map((row) => row.ownerId)).size !== playerSeats.length ||
    new Set(seats.map((row) => row.candidateId)).size !== seats.length
  )
    throw new Error("Assembly seating cannot duplicate a player's or nominee's mandate");
  const dumaOwners = new Set(
    seats
      .filter((row) => row.officeType === "dumaDeputy")
      .map((row) => `${row.isNpc ? "npc" : "player"}:${row.ownerId}`)
  );
  if (
    seats.some(
      (row) =>
        row.officeType === "federationCouncilMember" &&
        dumaOwners.has(`${row.isNpc ? "npc" : "player"}:${row.ownerId}`)
    )
  )
    throw new Error("Assembly chambers need disjoint owner profiles");
  const dumaSeats = seats
    .filter((row) => row.officeType === "dumaDeputy")
    .reduce((sum, row) => sum + row.seatsHeld, 0);
  const councilSeats = seats.filter((row) => row.officeType === "federationCouncilMember").length;
  if (dumaSeats > 450 || councilSeats > 178)
    throw new Error("Assembly mandate totals exceed their constitutional chambers");
  const seatsByParty: Record<string, number> = {};
  for (const row of seats.filter((row) => row.officeType === "dumaDeputy"))
    seatsByParty[row.party] = (seatsByParty[row.party] ?? 0) + row.seatsHeld;
  const owners = new Map<
    string,
    {
      ownerId: string;
      isNpc: boolean;
      officeType: RussianAssemblySeat["officeType"];
      seatsHeld: number;
    }
  >();
  for (const row of seats) {
    const key = `${row.isNpc ? "npc" : "player"}:${row.ownerId}`;
    const old = owners.get(key);
    owners.set(key, {
      ownerId: row.ownerId,
      isNpc: row.isNpc,
      officeType: row.officeType,
      seatsHeld: (old?.seatsHeld ?? 0) + row.seatsHeld,
    });
  }
  return {
    seats,
    owners: [...owners.values()],
    seatsByParty,
    dumaSeats,
    councilSeats,
    dumaVacancies: 450 - dumaSeats,
    councilVacancies: 178 - councilSeats,
  };
}

function roster(family: {
  nominees: readonly RussianAssemblySeatingNominee[];
  ballots: readonly {
    candidates: readonly { id: string; ownerId: string; party: string; isNpc: boolean }[];
  }[];
}) {
  const nominees = new Map(family.nominees.map((row) => [row.candidateId, row]));
  if (
    nominees.size !== family.nominees.length ||
    family.nominees.some(
      (row) =>
        !row.candidateId ||
        !row.ownerId ||
        !row.name.trim() ||
        !row.party ||
        typeof row.isNpc !== "boolean"
    )
  )
    throw new Error("Assembly seating needs unique named nominee identities");
  for (const ballot of family.ballots)
    for (const candidate of ballot.candidates) {
      const owner = nominees.get(candidate.id);
      if (
        !owner ||
        owner.ownerId !== candidate.ownerId ||
        owner.party !== candidate.party ||
        owner.isNpc !== candidate.isNpc
      )
        throw new Error("Assembly nominee receipt does not match its frozen ballot");
    }
  return nominees;
}

/** Recompute one certified Duma without recertifying or replacing the Council. */
export function planRussianDumaSeating(input: {
  generation?: number;
  ballots: readonly RussianDumaCohortBallot[];
  nominees: readonly RussianAssemblySeatingNominee[];
}) {
  if (!Number.isSafeInteger(input.generation ?? 0) || (input.generation ?? 0) < 0)
    throw new Error("Duma seating needs a safe certified generation");
  const duma = input.generation
    ? resolveRussianDumaAccumulatedCohort(input.ballots)
    : resolveRussianDumaCohort(input.ballots);
  const dumaNominees = roster(input);
  const seats: RussianAssemblySeat[] = [];
  for (const district of duma.constituencyResults)
    if (district.winner) {
      const nominee = dumaNominees.get(district.winner.id)!;
      seats.push({
        ...nominee,
        officeType: "dumaDeputy",
        state: district.regionId,
        seatId: district.seatId,
        electionId: district.electionId,
        seatsHeld: 1,
        seatSource: "direct",
      });
    }
  for (const [candidateId, count] of Object.entries(duma.listAssignment?.seatsByNominee ?? {})) {
    if (!count) continue;
    const nominee = dumaNominees.get(candidateId)!;
    seats.push({
      ...nominee,
      officeType: "dumaDeputy",
      state: "RU",
      seatId: "RU-duma-national-list",
      electionId: duma.listElectionId,
      seatsHeld: count,
      seatSource: "list",
    });
  }

  const players = seats.filter((row) => !row.isNpc);
  if (
    players.some((row) => row.seatsHeld !== 1) ||
    new Set(players.map((row) => row.ownerId)).size !== players.length ||
    new Set(seats.map((row) => row.candidateId)).size !== seats.length
  )
    throw new Error("Duma seating cannot duplicate a player's or nominee's mandate");
  return { seats, result: duma };
}
