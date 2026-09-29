import { apportionSeats as apportionRegions } from "@/lib/seeds/reference/rules/apportionSeats";
import { apportionSeats as apportionCandidates } from "@/lib/country/seatApportionment";
import {
  allocateHungaryMixed2014,
  HU_CONSTITUENCY_SEATS,
  type ConstituencyBallot,
  type HungaryMixedResult,
} from "./mixedElection2014";

export interface HuRaceVotes {
  electionId: string;
  regionId: string;
  candidates: ReadonlyArray<{ candidateId: string; partyId: string; votes: number }>;
}

export interface HuMixedPlan {
  result: HungaryMixedResult;
  /** Statutory constituency capacity plus seats drawn from the national list. */
  regionCapacity: Record<string, number>;
  candidateSeatsByElection: Record<string, Record<string, number>>;
}

function stableWeight(candidateId: string, districtId: string): number {
  let hash = 2166136261;
  for (const char of `${candidateId}:${districtId}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  return 80 + ((hash >>> 0) % 41);
}

/**
 * Model 106 district tallies from the game's six regional candidate tallies.
 * Every candidate's regional vote count is conserved across its district
 * ballots; fixed geographic variation produces distinct district races. The
 * national-list ballot uses party support summed across the same campaign.
 * The game has no separate list campaign choice yet, so list and constituency
 * support have the same regional baseline, as in its German second-vote model.
 */
export function buildHuMixedPlan(
  regions: ReadonlyArray<{ id: string; population: number }>,
  races: ReadonlyArray<HuRaceVotes>
): HuMixedPlan {
  if (regions.length === 0 || races.length !== regions.length) {
    throw new Error("Hungary mixed election requires one completed race per region");
  }
  const regionIds = new Set(regions.map((region) => region.id));
  if (
    regionIds.size !== regions.length ||
    new Set(races.map((race) => race.regionId)).size !== regions.length ||
    races.some((race) => !regionIds.has(race.regionId))
  ) {
    throw new Error("Hungary mixed election region coverage is invalid");
  }
  const orderedRegions = [...regions].sort((a, b) => a.id.localeCompare(b.id));
  const districtCounts = apportionRegions(
    HU_CONSTITUENCY_SEATS,
    Object.fromEntries(orderedRegions.map((region) => [region.id, region.population]))
  );
  const byRegion = new Map(races.map((race) => [race.regionId, race]));
  const constituencyBallots: ConstituencyBallot[] = [];
  const listVotes: Record<string, number> = {};
  const partyRegionVotes: Record<string, Record<string, number>> = {};
  for (const region of orderedRegions) {
    const race = byRegion.get(region.id)!;
    if (race.candidates.length === 0 || !(districtCounts[region.id] > 0)) {
      throw new Error(`Hungary mixed election has no candidates or districts in ${region.id}`);
    }
    const candidateIds = new Set<string>();
    const districts = Array.from(
      { length: districtCounts[region.id] },
      (_, index) => `${region.id}:${index + 1}`
    );
    const candidateDistrictVotes: Record<string, Record<string, number>> = {};
    for (const candidate of race.candidates) {
      if (
        !candidate.candidateId ||
        !candidate.partyId ||
        candidateIds.has(candidate.candidateId) ||
        !Number.isSafeInteger(candidate.votes) ||
        candidate.votes < 0
      ) {
        throw new Error("Invalid Hungarian election candidate tally");
      }
      candidateIds.add(candidate.candidateId);
      candidateDistrictVotes[candidate.candidateId] = apportionRegions(
        candidate.votes,
        Object.fromEntries(districts.map((id) => [id, stableWeight(candidate.candidateId, id)]))
      );
      listVotes[candidate.partyId] = (listVotes[candidate.partyId] ?? 0) + candidate.votes;
      partyRegionVotes[candidate.partyId] ??= {};
      partyRegionVotes[candidate.partyId][region.id] =
        (partyRegionVotes[candidate.partyId][region.id] ?? 0) + candidate.votes;
    }
    for (const districtId of districts) {
      const votesByParty: Record<string, number> = {};
      for (const candidate of race.candidates) {
        votesByParty[candidate.partyId] =
          (votesByParty[candidate.partyId] ?? 0) +
          candidateDistrictVotes[candidate.candidateId][districtId];
      }
      constituencyBallots.push({
        id: districtId,
        votes: Object.entries(votesByParty).map(([partyId, votes]) => ({ partyId, votes })),
      });
    }
  }
  const result = allocateHungaryMixed2014(
    constituencyBallots,
    Object.entries(listVotes).map(([partyId, votes]) => ({ partyId, votes }))
  );
  const partySeatsByRegion: Record<string, Record<string, number>> = {};
  for (const [districtId, winner] of Object.entries(result.constituencyWinners)) {
    if (!winner) continue;
    const regionId = districtId.split(":")[0];
    partySeatsByRegion[regionId] ??= {};
    partySeatsByRegion[regionId][winner] = (partySeatsByRegion[regionId][winner] ?? 0) + 1;
  }
  const regionCapacity = { ...districtCounts };
  for (const [partyId, seats] of Object.entries(result.listSeats)) {
    const shares = apportionCandidates(partyRegionVotes[partyId] ?? {}, seats);
    for (const [regionId, share] of Object.entries(shares)) {
      partySeatsByRegion[regionId] ??= {};
      partySeatsByRegion[regionId][partyId] = (partySeatsByRegion[regionId][partyId] ?? 0) + share;
      regionCapacity[regionId] += share;
    }
  }
  const candidateSeatsByElection: Record<string, Record<string, number>> = {};
  for (const race of races) {
    const seats: Record<string, number> = Object.fromEntries(
      race.candidates.map((c) => [c.candidateId, 0])
    );
    for (const [partyId, total] of Object.entries(partySeatsByRegion[race.regionId] ?? {})) {
      const candidates = race.candidates.filter((candidate) => candidate.partyId === partyId);
      const shares = apportionCandidates(
        Object.fromEntries(candidates.map((c) => [c.candidateId, c.votes])),
        total
      );
      for (const [candidateId, count] of Object.entries(shares)) seats[candidateId] = count;
    }
    candidateSeatsByElection[race.electionId] = seats;
  }
  return { result, regionCapacity, candidateSeatsByElection };
}
