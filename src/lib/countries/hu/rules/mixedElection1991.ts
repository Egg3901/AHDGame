/**
 * Hungary's 1991 Assembly combines 176 constituency, 152 territorial and 58
 * national compensation mandates. Territorial vacancies expand the national
 * tier; failed constituency ballots retain a vacant seat for a by-election.
 */
import {
  HU_1991_CONSTITUENCIES,
  HU_1991_TERRITORIAL_DISTRICTS,
} from "../data/electoralDistricts1991";
import { countHu1991Constituency, type Hu1991ConstituencyRound } from "./constituency1991";
import {
  countHu1991NationalCompensation,
  countHu1991TerritorialList,
  eligibleHu1991Parties,
  sumHu1991Fragments,
  type Hu1991FragmentVote,
  type Hu1991ListVote,
} from "./listAllocation1991";
import type { HuMixedElectoralLaw } from "./electoralLaw";

export interface Hu1991TerritorialRound {
  registeredVoters: number;
  ballotsCast: number;
  lists: readonly Hu1991ListVote[];
}
export interface Hu1991MixedBallots {
  electoralLaw?: HuMixedElectoralLaw;
  constituencies: readonly {
    id: string;
    first: Hu1991ConstituencyRound;
    second?: Hu1991ConstituencyRound;
  }[];
  territorial: readonly {
    id: string;
    first: Hu1991TerritorialRound;
    second?: Hu1991TerritorialRound;
    repeats?: readonly { first: Hu1991TerritorialRound; second?: Hu1991TerritorialRound }[];
  }[];
  nationalLists: readonly { partyId: string; ballotOrder: number }[];
}
export type Hu1991MixedCount =
  | {
      kind: "pending";
      reason: "runoff-required";
      constituencyRunoffs: Record<string, string[]>;
      territorialRunoffs: string[];
      territorialRepeats?: string[];
    }
  | {
      kind: "counted";
      constituencyWinners: Record<string, string | null>;
      constituencyParties: Record<string, string | null>;
      constituencySeats: Record<string, number>;
      territorialSeats: Record<string, Record<string, number>>;
      nationalSeats: Record<string, number>;
      partySeats: Record<string, number>;
      eligibleParties: string[];
      nationalCapacity: number;
      constituencyVacancies: string[];
      nationalVacancies: number;
      compensationVotes: Record<string, Hu1991FragmentVote>;
    };

function validTerritorialRound(round: Hu1991TerritorialRound, second: boolean): boolean {
  // Also validates all list identities, votes and serials before testing turnout.
  eligibleHu1991Parties(round.lists);
  if (
    !Number.isSafeInteger(round.registeredVoters) ||
    round.registeredVoters < 1 ||
    !Number.isSafeInteger(round.ballotsCast) ||
    round.ballotsCast < 0 ||
    round.ballotsCast > round.registeredVoters ||
    round.lists.reduce((s, r) => s + r.votes, 0) > round.ballotsCast
  )
    throw new Error("Invalid Hungarian territorial electorate or turnout");
  return BigInt(round.ballotsCast) * BigInt(second ? 4 : 2) > BigInt(round.registeredVoters);
}

export function countHuMixed1991(ballots: Hu1991MixedBallots): Hu1991MixedCount {
  const districtIds = new Set(HU_1991_CONSTITUENCIES.map((r) => r.id));
  const countyIds = new Set(HU_1991_TERRITORIAL_DISTRICTS.map((r) => r.id));
  if (
    ballots.constituencies.length !== 176 ||
    new Set(ballots.constituencies.map((r) => r.id)).size !== 176 ||
    ballots.constituencies.some((r) => !districtIds.has(r.id)) ||
    ballots.territorial.length !== 20 ||
    new Set(ballots.territorial.map((r) => r.id)).size !== 20 ||
    ballots.territorial.some((r) => !countyIds.has(r.id))
  )
    throw new Error(
      "Hungarian 1991 count requires all 176 constituencies and 20 territorial ballots"
    );
  const districtMetadata = new Map(HU_1991_CONSTITUENCIES.map((row) => [row.id, row]));
  const nominations = new Map<string, Map<string, number>>();
  const nationalIds = new Set<string>(),
    nationalOrders = new Set<number>();
  for (const row of ballots.nationalLists) {
    if (
      !row.partyId ||
      row.partyId === "independent" ||
      nationalIds.has(row.partyId) ||
      !Number.isSafeInteger(row.ballotOrder) ||
      row.ballotOrder < 1 ||
      nationalOrders.has(row.ballotOrder)
    )
      throw new Error("Invalid Hungarian national list identity or serial");
    nationalIds.add(row.partyId);
    nationalOrders.add(row.ballotOrder);
    if (
      ballots.territorial.filter((county) =>
        county.first.lists.some((list) => list.partyId === row.partyId)
      ).length < 7
    )
      throw new Error("Hungarian national list requires seven filed territorial lists");
  }
  const candidates = new Set<string>();
  const constituencyRunoffs: Record<string, string[]> = {};
  const constituencyWinners: Record<string, string | null> = {};
  const constituencyParties: Record<string, string | null> = {};
  const constituencySeats: Record<string, number> = {};
  const constituencyVacancies: string[] = [];
  const fragments: Record<string, Hu1991FragmentVote[]> = {};
  for (const ballot of ballots.constituencies) {
    const parties = new Set<string>();
    for (const nominee of ballot.first.candidates) {
      if (candidates.has(nominee.candidateId))
        throw new Error("One Hungarian person cannot contest multiple constituencies");
      candidates.add(nominee.candidateId);
      if (nominee.partyId !== "independent" && parties.has(nominee.partyId))
        throw new Error("A Hungarian party nominates one person per constituency");
      parties.add(nominee.partyId);
      if (nominee.partyId !== "independent") {
        const countyId = districtMetadata.get(ballot.id)!.countyId;
        const counts = nominations.get(countyId) ?? new Map<string, number>();
        counts.set(nominee.partyId, (counts.get(nominee.partyId) ?? 0) + 1);
        nominations.set(countyId, counts);
      }
    }
    const result = countHu1991Constituency(ballot.first, ballot.second);
    if (result.kind === "runoff") {
      constituencyRunoffs[ballot.id] = result.candidateIds;
      continue;
    }
    constituencyWinners[ballot.id] = result.winnerId;
    constituencyParties[ballot.id] = result.winnerParty;
    if (result.winnerParty)
      constituencySeats[result.winnerParty] = (constituencySeats[result.winnerParty] ?? 0) + 1;
    else constituencyVacancies.push(ballot.id);
    for (const [party, votes] of Object.entries(result.compensationVotes)) {
      fragments[party] ??= [];
      fragments[party].push({ numerator: String(votes), denominator: "1" });
    }
  }
  const territorialRunoffs: string[] = [];
  const territorialRepeats: string[] = [];
  const selected = new Map<string, Hu1991TerritorialRound>();
  for (const ballot of ballots.territorial) {
    const county = HU_1991_TERRITORIAL_DISTRICTS.find((row) => row.id === ballot.id)!;
    for (const list of ballot.first.lists) {
      if ((nominations.get(county.id)?.get(list.partyId) ?? 0) < county.minimumConstituencyNominees)
        throw new Error(
          "Hungarian territorial list lacks its statutory filed constituency nominees"
        );
    }
    const originals = new Map(ballot.first.lists.map((r) => [r.partyId, r.ballotOrder]));
    const generations = [{ first: ballot.first, second: ballot.second }, ...(ballot.repeats ?? [])];
    for (const [index, generation] of generations.entries()) {
      for (const round of [generation.first, generation.second]) {
        if (!round) continue;
        if (round.registeredVoters !== ballot.first.registeredVoters)
          throw new Error("Hungarian territorial runoff changes its frozen electorate");
        if (round.lists.some((r) => originals.get(r.partyId) !== r.ballotOrder))
          throw new Error("Hungarian territorial runoff introduces a new list");
      }
      const last = index === generations.length - 1;
      if (validTerritorialRound(generation.first, false)) {
        if (generation.second || !last)
          throw new Error("Valid Hungarian territorial ballot cannot be counted a second time");
        selected.set(ballot.id, generation.first);
        break;
      }
      if (!generation.second) {
        if (!last) throw new Error("Hungarian territorial repeat skips an unfinished round");
        territorialRunoffs.push(ballot.id);
        break;
      }
      if (validTerritorialRound(generation.second, true)) {
        if (!last)
          throw new Error("Valid Hungarian territorial ballot cannot be counted a second time");
        selected.set(ballot.id, generation.second);
        break;
      }
      if (last) territorialRepeats.push(ballot.id);
    }
  }
  if (
    Object.keys(constituencyRunoffs).length ||
    territorialRunoffs.length ||
    territorialRepeats.length
  )
    return {
      kind: "pending",
      reason: "runoff-required",
      constituencyRunoffs,
      territorialRunoffs,
      ...(territorialRepeats.length ? { territorialRepeats } : {}),
    };
  const totals: Record<string, number> = {};
  for (const round of selected.values())
    for (const row of round.lists) totals[row.partyId] = (totals[row.partyId] ?? 0) + row.votes;
  const eligibleParties = eligibleHu1991Parties(
    Object.entries(totals).map(([partyId, votes], index) => ({
      partyId,
      votes,
      ballotOrder: index + 1,
    })),
    ballots.electoralLaw
  );
  const territorialSeats: Record<string, Record<string, number>> = {};
  const partySeats = { ...constituencySeats };
  let nationalCapacity = 58;
  for (const county of HU_1991_TERRITORIAL_DISTRICTS) {
    const result = countHu1991TerritorialList(
      selected.get(county.id)!.lists,
      county.territorialSeats,
      eligibleParties
    );
    territorialSeats[county.id] = result.partySeats;
    nationalCapacity += result.unfilledSeats;
    for (const [party, seats] of Object.entries(result.partySeats))
      partySeats[party] = (partySeats[party] ?? 0) + seats;
    for (const [party, votes] of Object.entries(result.fragments)) {
      fragments[party] ??= [];
      fragments[party].push(votes);
    }
  }
  const compensationVotes = Object.fromEntries(
    Object.entries(fragments)
      .filter(([party]) => eligibleParties.includes(party))
      .map(([party, votes]) => [party, sumHu1991Fragments(votes)])
  );
  const national = ballots.nationalLists.filter((row) => eligibleParties.includes(row.partyId));
  const result = countHu1991NationalCompensation(
    national.map((row) => ({
      ...row,
      fragments: compensationVotes[row.partyId] ?? { numerator: "0", denominator: "1" },
    })),
    nationalCapacity
  );
  for (const [party, seats] of Object.entries(result.partySeats))
    partySeats[party] = (partySeats[party] ?? 0) + seats;
  if (
    Object.values(partySeats).reduce((s, n) => s + n, 0) +
      constituencyVacancies.length +
      result.unfilledSeats !==
    386
  )
    throw new Error("Hungarian mixed count fails 386-mandate conservation");
  return {
    kind: "counted",
    constituencyWinners,
    constituencyParties,
    constituencySeats,
    territorialSeats,
    nationalSeats: result.partySeats,
    partySeats,
    eligibleParties,
    nationalCapacity,
    constituencyVacancies,
    nationalVacancies: result.unfilledSeats,
    compensationVotes,
  };
}
