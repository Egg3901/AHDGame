/**
 * Japan's lower-house ballot keeps constituency choices separate from the regional party-list vote.
 * Direct candidates contest statutory districts; party support is apportioned as a second vote.
 */
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";
import { JP_SHUGIIN_1994_CONSTITUENCIES } from "../data/jpShugiinConstituencies1994";

export interface JapanBallotCandidate {
  candidateId: string;
  partyId: string;
  constituencyId?: string;
  isNPP?: boolean;
  votes: number;
}

export interface JapanPartyListSupport {
  partyId: string;
  registration?: number;
  organization?: number;
}

function districtContestKey(candidate: JapanBallotCandidate): string {
  if (candidate.constituencyId) return `direct:${candidate.candidateId}`;
  return candidate.partyId === "independent"
    ? `independent:${candidate.candidateId}`
    : candidate.partyId;
}

function stableIndex(value: string, length: number): number {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % length;
}

/** Build each district's ballot from explicit player nominations and existing NPP slates. */
export function buildJapanDistrictSlate(
  regionId: string,
  candidates: ReadonlyArray<JapanBallotCandidate>
): Record<string, Record<string, string>> {
  const districts = JP_SHUGIIN_1994_CONSTITUENCIES.filter((row) => row.regionId === regionId);
  if (districts.length === 0) throw new Error(`Unknown Shugiin region ${regionId}`);
  const parties = [
    ...new Set(candidates.map((row) => row.partyId).filter((id) => id !== "independent")),
  ].sort();
  const slate: Record<string, Record<string, string>> = {};
  for (const district of districts) {
    slate[district.id] = {};
    for (const partyId of parties) {
      const partyCandidates = candidates.filter((row) => row.partyId === partyId);
      const filed = partyCandidates.filter((row) => row.constituencyId === district.id);
      if (filed.length > 0) {
        for (const nominee of filed) {
          slate[district.id][districtContestKey(nominee)] = nominee.candidateId;
        }
        continue;
      }
      const regionalNpps = partyCandidates.filter((row) => row.isNPP && !row.constituencyId);
      const nominee =
        regionalNpps.length > 0
          ? [...regionalNpps].sort((a, b) => a.candidateId.localeCompare(b.candidateId))[
              stableIndex(`${district.id}:${partyId}`, regionalNpps.length)
            ]
          : undefined;
      if (nominee) slate[district.id][partyId] = nominee.candidateId;
    }
    for (const nominee of candidates.filter(
      (row) => row.partyId === "independent" && row.constituencyId === district.id
    )) {
      slate[district.id][districtContestKey(nominee)] = nominee.candidateId;
    }
  }
  return slate;
}

/** Allocate the modeled second vote across party support, independently of direct nominees. */
export function allocateJapanListTurnVotes(
  turnout: number,
  parties: ReadonlyArray<JapanPartyListSupport>
): Record<string, number> {
  if (!Number.isSafeInteger(turnout) || turnout < 0) throw new Error("Invalid Japan list turnout");
  const weights: Record<string, number> = {};
  for (const party of parties) {
    if (!party.partyId || party.partyId === "independent" || party.partyId in weights)
      throw new Error("Invalid Japan party list");
    const registration = party.registration;
    const organization = party.organization;
    if (
      (registration !== undefined && (!Number.isFinite(registration) || registration < 0)) ||
      (organization !== undefined && (!Number.isFinite(organization) || organization < 0))
    )
      throw new Error("Invalid Japan party support");
    weights[party.partyId] =
      registration && registration > 0
        ? registration
        : organization && organization > 0
          ? organization
          : 1;
  }
  return Object.keys(weights).length === 0 ? {} : apportionSeats(turnout, weights);
}

/** Store candidate-level district votes and separate regional party-list votes. */
export function accumulateJapanBallots(input: {
  regionId: string;
  candidates: ReadonlyArray<JapanBallotCandidate>;
  listVoteIncrements: Readonly<Record<string, number>>;
  previousDistricts?: Record<string, Record<string, number>>;
  previousLists?: Record<string, number>;
}): {
  constituencyVotes: Record<string, Record<string, number>>;
  listVotes: Record<string, number>;
  districtSlate: Record<string, Record<string, string>>;
} {
  const districts = JP_SHUGIIN_1994_CONSTITUENCIES.filter(
    (row) => row.regionId === input.regionId
  ).map((row) => row.id);
  const districtSlate = buildJapanDistrictSlate(input.regionId, input.candidates);
  const activeIds = new Set(input.candidates.map((row) => row.candidateId));
  const activeParties = new Set(input.candidates.map((row) => row.partyId));
  const constituencyVotes = Object.fromEntries(
    districts.map((districtId) => [
      districtId,
      Object.fromEntries(
        Object.entries(input.previousDistricts?.[districtId] ?? {}).filter(
          ([candidateId]) =>
            activeIds.has(candidateId) &&
            Object.values(districtSlate[districtId]).includes(candidateId)
        )
      ),
    ])
  );
  const listVotes = Object.fromEntries(
    Object.entries(input.previousLists ?? {}).filter(([partyId]) => activeParties.has(partyId))
  );
  for (const candidate of input.candidates) {
    if (!Number.isSafeInteger(candidate.votes) || candidate.votes < 0)
      throw new Error("Invalid Japan turn vote");
    if (candidate.constituencyId && !districts.includes(candidate.constituencyId))
      throw new Error("Japan candidate filed outside region");
    const eligible = districts.filter(
      (districtId) =>
        districtSlate[districtId][districtContestKey(candidate)] === candidate.candidateId
    );
    if (eligible.length === 0) continue;
    const assigned = candidate.constituencyId
      ? { [candidate.constituencyId]: candidate.votes }
      : apportionSeats(candidate.votes, Object.fromEntries(eligible.map((id) => [id, 1])));
    for (const [districtId, votes] of Object.entries(assigned)) {
      constituencyVotes[districtId][candidate.candidateId] =
        (constituencyVotes[districtId][candidate.candidateId] ?? 0) + votes;
    }
  }
  for (const [partyId, votes] of Object.entries(input.listVoteIncrements)) {
    if (
      !activeParties.has(partyId) ||
      partyId === "independent" ||
      !Number.isSafeInteger(votes) ||
      votes < 0
    )
      throw new Error("Invalid Japan regional-list ballot");
    listVotes[partyId] = (listVotes[partyId] ?? 0) + votes;
  }
  return { constituencyVotes, listVotes, districtSlate };
}
