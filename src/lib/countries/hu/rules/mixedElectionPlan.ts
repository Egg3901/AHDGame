import { apportionSeats as apportionRegions } from "@/lib/seeds/reference/rules/apportionSeats";
import { apportionSeats as apportionCandidates } from "@/lib/country/seatApportionment";
import { huDistrictIds } from "./constituencies2014";
import {
  allocateHungaryMixed2014,
  type ConstituencyBallot,
  type HungaryMixedResult,
} from "./mixedElection2014";

export interface HuRaceVotes {
  electionId: string;
  regionId: string;
  candidates: ReadonlyArray<{ candidateId: string; partyId: string; votes: number }>;
  constituencyVotes?: Record<string, Record<string, number>>;
  listVotes?: Record<string, number>;
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

function ballotParty(candidate: { candidateId: string; partyId: string }): string {
  return candidate.partyId === "independent"
    ? `independent@${candidate.candidateId}`
    : candidate.partyId;
}

/**
 * Model 106 district tallies from the game's six regional candidate tallies.
 * Party candidates' regional vote count is conserved across district ballots;
 * fixed geographic variation produces distinct district races. An independent
 * candidate contests one deterministic district and receives that district's
 * share of the regional tally. The
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
  const districtCounts = Object.fromEntries(
    orderedRegions.map((region) => [region.id, huDistrictIds(region.id).length])
  );
  const byRegion = new Map(races.map((race) => [race.regionId, race]));
  const literal = races.every((race) => race.constituencyVotes && race.listVotes);
  if (!literal && races.some((race) => race.constituencyVotes || race.listVotes)) {
    throw new Error("Hungary mixed election has incomplete separate ballots");
  }
  const constituencyBallots: ConstituencyBallot[] = [];
  const listVotes: Record<string, number> = {};
  const partyRegionVotes: Record<string, Record<string, number>> = {};
  for (const region of orderedRegions) {
    const race = byRegion.get(region.id)!;
    if (race.candidates.length === 0 || !(districtCounts[region.id] > 0)) {
      throw new Error(`Hungary mixed election has no candidates or districts in ${region.id}`);
    }
    const candidateIds = new Set<string>();
    const districts = huDistrictIds(region.id);
    if (literal && districts.some((district) => !race.constituencyVotes?.[district])) {
      throw new Error(`Hungary mixed election has missing constituency ballot in ${region.id}`);
    }
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
      candidateDistrictVotes[candidate.candidateId] = literal
        ? Object.fromEntries(
            districts.map((id) => [id, race.constituencyVotes?.[id]?.[candidate.candidateId] ?? 0])
          )
        : candidate.partyId === "independent"
          ? {
              [districts[stableWeight(candidate.candidateId, "assignment") % districts.length]]:
                Math.round(candidate.votes / districts.length),
            }
          : apportionRegions(
              candidate.votes,
              Object.fromEntries(
                districts.map((id) => [id, stableWeight(candidate.candidateId, id)])
              )
            );
      if (!literal && candidate.partyId !== "independent") {
        listVotes[candidate.partyId] = (listVotes[candidate.partyId] ?? 0) + candidate.votes;
        partyRegionVotes[candidate.partyId] ??= {};
        partyRegionVotes[candidate.partyId][region.id] =
          (partyRegionVotes[candidate.partyId][region.id] ?? 0) + candidate.votes;
      }
    }
    if (literal) {
      for (const [partyId, votes] of Object.entries(race.listVotes ?? {})) {
        if (!Number.isSafeInteger(votes) || votes < 0)
          throw new Error("Invalid Hungarian list vote");
        listVotes[partyId] = (listVotes[partyId] ?? 0) + votes;
        partyRegionVotes[partyId] ??= {};
        partyRegionVotes[partyId][region.id] = (partyRegionVotes[partyId][region.id] ?? 0) + votes;
      }
    }
    for (const districtId of districts) {
      const votesByParty: Record<string, number> = {};
      for (const candidate of race.candidates) {
        const partyId = ballotParty(candidate);
        votesByParty[partyId] =
          (votesByParty[partyId] ?? 0) +
          (candidateDistrictVotes[candidate.candidateId][districtId] ?? 0);
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
  const directCandidateSeats: Record<string, Record<string, number>> = {};
  for (const [districtId, winner] of Object.entries(result.constituencyWinners)) {
    if (!winner) continue;
    const regionId = districtId.split(":")[0];
    if (literal) {
      const race = byRegion.get(regionId)!;
      const winningCandidate = race.candidates
        .filter((candidate) => ballotParty(candidate) === winner)
        .sort(
          (a, b) =>
            (race.constituencyVotes?.[districtId]?.[b.candidateId] ?? 0) -
              (race.constituencyVotes?.[districtId]?.[a.candidateId] ?? 0) ||
            a.candidateId.localeCompare(b.candidateId)
        )[0];
      if (!winningCandidate) throw new Error("Hungarian district winner has no candidate");
      directCandidateSeats[race.electionId] ??= {};
      directCandidateSeats[race.electionId][winningCandidate.candidateId] =
        (directCandidateSeats[race.electionId][winningCandidate.candidateId] ?? 0) + 1;
    }
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
    for (const [candidateId, count] of Object.entries(
      directCandidateSeats[race.electionId] ?? {}
    )) {
      seats[candidateId] = count;
    }
    for (const [partyId, total] of Object.entries(partySeatsByRegion[race.regionId] ?? {})) {
      const candidates = race.candidates.filter((candidate) => ballotParty(candidate) === partyId);
      const districtSeats = candidates.reduce(
        (sum, candidate) =>
          sum + (directCandidateSeats[race.electionId]?.[candidate.candidateId] ?? 0),
        0
      );
      const shares = apportionCandidates(
        Object.fromEntries(candidates.map((c) => [c.candidateId, c.votes])),
        total - districtSeats
      );
      for (const [candidateId, count] of Object.entries(shares)) seats[candidateId] += count;
    }
    candidateSeatsByElection[race.electionId] = seats;
  }
  return { result, regionCapacity, candidateSeatsByElection };
}
