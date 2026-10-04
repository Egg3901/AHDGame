import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";
import { huDistrictIds } from "./constituencies2014";

export interface HuBallotCandidate {
  candidateId: string;
  partyId: string;
  constituencyId?: string;
  isNPP?: boolean;
  votes: number;
}

function stableIndex(value: string, length: number): number {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % length;
}

/** Select one filed nominee per party and district. NPP regional slates supply
 * nominees for seats with no named filing, without creating duplicate people. */
export function buildHuDistrictSlate(
  regionId: string,
  candidates: ReadonlyArray<HuBallotCandidate>
): Record<string, Record<string, string>> {
  const districts = huDistrictIds(regionId);
  const slate: Record<string, Record<string, string>> = {};
  const parties = [...new Set(candidates.map((candidate) => candidate.partyId))].sort();
  for (const districtId of districts) {
    slate[districtId] = {};
    for (const partyId of parties) {
      const partyCandidates = candidates.filter((candidate) => candidate.partyId === partyId);
      const filed = partyCandidates.filter((candidate) => candidate.constituencyId === districtId);
      if (filed.length > 1) throw new Error("Hungarian party filed multiple district nominees");
      const regionalNpps = partyCandidates.filter(
        (candidate) => candidate.isNPP && !candidate.constituencyId
      );
      const nominee =
        filed[0] ??
        (regionalNpps.length > 0
          ? [...regionalNpps].sort((a, b) => a.candidateId.localeCompare(b.candidateId))[
              stableIndex(`${districtId}:${partyId}`, regionalNpps.length)
            ]
          : undefined);
      if (nominee) slate[districtId][partyId] = nominee.candidateId;
    }
  }
  return slate;
}

export function accumulateHuBallots(
  regionId: string,
  candidates: ReadonlyArray<HuBallotCandidate>,
  listVoteIncrements: Readonly<Record<string, number>>,
  previousDistricts: Record<string, Record<string, number>> = {},
  previousLists: Record<string, number> = {}
): {
  constituencyVotes: Record<string, Record<string, number>>;
  listVotes: Record<string, number>;
  districtSlate: Record<string, Record<string, string>>;
} {
  const districts = huDistrictIds(regionId);
  const districtSlate = buildHuDistrictSlate(regionId, candidates);
  const activeCandidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
  const partyByCandidateId = new Map(
    candidates.map((candidate) => [candidate.candidateId, candidate.partyId])
  );
  const activePartyIds = new Set(candidates.map((candidate) => candidate.partyId));
  const constituencyVotes = Object.fromEntries(
    districts.map((id) => [
      id,
      Object.fromEntries(
        Object.entries(previousDistricts[id] ?? {}).filter(
          ([candidateId]) =>
            activeCandidateIds.has(candidateId) &&
            districtSlate[id][partyByCandidateId.get(candidateId) ?? ""] === candidateId
        )
      ),
    ])
  );
  const listVotes = Object.fromEntries(
    Object.entries(previousLists).filter(([partyId]) => activePartyIds.has(partyId))
  );
  for (const candidate of candidates) {
    if (!Number.isSafeInteger(candidate.votes) || candidate.votes < 0) {
      throw new Error("Invalid Hungarian turn vote");
    }
    const eligible = districts.filter(
      (districtId) => districtSlate[districtId][candidate.partyId] === candidate.candidateId
    );
    if (candidate.constituencyId && !districts.includes(candidate.constituencyId)) {
      throw new Error("Hungarian candidate filed outside region");
    }
    if (eligible.length === 0) continue;
    const districtShares = apportionSeats(
      candidate.constituencyId ? Math.round(candidate.votes / districts.length) : candidate.votes,
      Object.fromEntries(eligible.map((id) => [id, 1]))
    );
    for (const [id, votes] of Object.entries(districtShares)) {
      constituencyVotes[id][candidate.candidateId] =
        (constituencyVotes[id][candidate.candidateId] ?? 0) + votes;
    }
  }
  for (const [partyId, votes] of Object.entries(listVoteIncrements)) {
    if (
      !activePartyIds.has(partyId) ||
      partyId === "independent" ||
      !Number.isSafeInteger(votes) ||
      votes < 0
    ) {
      throw new Error("Invalid Hungarian national-list ballot");
    }
    listVotes[partyId] = (listVotes[partyId] ?? 0) + votes;
  }
  return { constituencyVotes, listVotes, districtSlate };
}
