/**
 * Japan elects district members by local ballots and regional list members by party vote.
 * A player direct winner cannot take a second list seat; bounded NPC rows represent separate people.
 */
import { JP_SHUGIIN_1994_CONSTITUENCIES } from "../data/jpShugiinConstituencies1994";
import { JP_SHUGIIN_1994_LIST_SEATS } from "./shugiinElectoralLaw";

export interface ShugiinDistrictCandidate {
  candidateId: string;
  partyId: string;
  votes: number;
  /** A roster actor may stand for a bounded NPC slate across districts. */
  isNPP?: boolean;
}

export interface ShugiinListCandidate {
  candidateId: string;
  partyId: string;
  /** Lower number is higher on the filed party list. */
  listOrder: number;
  /** A roster actor may stand for a bounded NPC slate across regions. */
  isNPP?: boolean;
}

export interface JapanMixedShugiinBallots {
  districtVotes: Readonly<Record<string, readonly ShugiinDistrictCandidate[]>>;
  listVotesByRegion: Readonly<Record<string, Readonly<Record<string, number>>>>;
  regionalLists: Readonly<Record<string, readonly ShugiinListCandidate[]>>;
}

export interface JapanMixedShugiinResult {
  totalSeats: number;
  districtSeats: number;
  listSeats: number;
  seatsByCandidate: Record<string, number>;
  partySeatsByRegion: Record<string, Record<string, number>>;
  directWinners: Record<string, string | null>;
  listWinners: Record<string, string[]>;
  vacancies: string[];
}

/** Build deterministic regional list rows from filed players and one bounded NPC representative per party. */
export function buildJapanMixedRegionalList(
  candidates: ReadonlyArray<{
    candidateId: string;
    partyId: string;
    listOrder?: number | null;
    isNPP?: boolean;
    enteredAt?: number;
  }>,
  excludedCandidateIds: ReadonlySet<string> = new Set()
): ShugiinListCandidate[] {
  const rawFiled = candidates
    .filter(
      (row) =>
        row.partyId !== "independent" &&
        row.listOrder != null &&
        !excludedCandidateIds.has(row.candidateId)
    )
    .map((row) => ({
      candidateId: row.candidateId,
      partyId: row.partyId,
      listOrder: row.listOrder!,
      isNPP: row.isNPP,
    }))
    .sort(
      (left, right) =>
        left.partyId.localeCompare(right.partyId) ||
        left.listOrder - right.listOrder ||
        left.candidateId.localeCompare(right.candidateId)
    );
  const rankByParty = new Map<string, number>();
  const filed = rawFiled.map((row) => {
    const listOrder = (rankByParty.get(row.partyId) ?? 0) + 1;
    rankByParty.set(row.partyId, listOrder);
    return { ...row, listOrder };
  });
  const filedIds = new Set(filed.map((row) => row.candidateId));
  const nextRankByParty = new Map<string, number>();
  for (const row of filed) {
    nextRankByParty.set(
      row.partyId,
      Math.max(nextRankByParty.get(row.partyId) ?? 0, row.listOrder)
    );
  }
  const npcByParty = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    if (
      !candidate.isNPP ||
      candidate.partyId === "independent" ||
      filedIds.has(candidate.candidateId) ||
      excludedCandidateIds.has(candidate.candidateId)
    )
      continue;
    const prior = npcByParty.get(candidate.partyId);
    if (
      !prior ||
      (candidate.enteredAt ?? 0) < (prior.enteredAt ?? 0) ||
      ((candidate.enteredAt ?? 0) === (prior.enteredAt ?? 0) &&
        candidate.candidateId.localeCompare(prior.candidateId) < 0)
    ) {
      npcByParty.set(candidate.partyId, candidate);
    }
  }
  const boundedNpcRows = [...npcByParty.values()].map((candidate) => ({
    candidateId: candidate.candidateId,
    partyId: candidate.partyId,
    listOrder: (nextRankByParty.get(candidate.partyId) ?? 0) + 1,
    isNPP: true,
  }));
  return [...filed, ...boundedNpcRows];
}

/** Merge second-vote totals through the surviving-party resolver after party mergers. */
export function remapJapanShugiinListVotes(
  votes: Readonly<Record<string, number>>,
  resolveParty: (partyId: string) => string | null
): Record<string, number> {
  const remapped: Record<string, number> = {};
  for (const [sourcePartyId, count] of Object.entries(votes)) {
    const partyId = resolveParty(sourcePartyId) ?? sourcePartyId;
    remapped[partyId] = (remapped[partyId] ?? 0) + count;
  }
  return remapped;
}

/**
 * Count actual district-specific plurality ballots, then allocate each legal
 * regional list bloc by D'Hondt. Player direct winners are excluded from list seats.
 */
export function countJapanMixedShugiin(
  ballots: JapanMixedShugiinBallots,
  regionId?: string
): JapanMixedShugiinResult {
  const districtById = new Map(JP_SHUGIIN_1994_CONSTITUENCIES.map((row) => [row.id, row]));
  const activeDistricts = JP_SHUGIIN_1994_CONSTITUENCIES.filter(
    (row) => regionId == null || row.regionId === regionId
  );
  const activeRegions = Object.keys(JP_SHUGIIN_1994_LIST_SEATS).filter(
    (id) => regionId == null || regionId === id
  );
  const submittedDistricts = Object.keys(ballots.districtVotes);
  if (
    submittedDistricts.length !== activeDistricts.length ||
    submittedDistricts.some(
      (id) => !districtById.has(id) || !activeDistricts.some((d) => d.id === id)
    )
  ) {
    throw new Error(
      regionId == null
        ? "Japan mixed count requires the complete statutory 300-district ballot map"
        : `Japan mixed count requires the complete statutory district ballot map for ${regionId}`
    );
  }
  const directWinners: Record<string, string | null> = {};
  const seatsByCandidate: Record<string, number> = {};
  const ownerDistrict = new Map<string, string>();
  const partyByCandidate = new Map<string, string>();
  for (const district of activeDistricts) {
    const candidates = ballots.districtVotes[district.id];
    if (!Array.isArray(candidates)) throw new Error(`Missing district ballot ${district.id}`);
    const ids = new Set<string>();
    for (const candidate of candidates) {
      if (
        !candidate.candidateId ||
        !candidate.partyId ||
        ids.has(candidate.candidateId) ||
        !Number.isSafeInteger(candidate.votes) ||
        candidate.votes < 0
      ) {
        throw new Error(`Invalid candidate on district ballot ${district.id}`);
      }
      ids.add(candidate.candidateId);
      const knownParty = partyByCandidate.get(candidate.candidateId);
      if (knownParty && knownParty !== candidate.partyId)
        throw new Error("A Shugiin candidate cannot change party between ballots");
      partyByCandidate.set(candidate.candidateId, candidate.partyId);
      seatsByCandidate[candidate.candidateId] ??= 0;
      const otherDistrict = ownerDistrict.get(candidate.candidateId);
      if (otherDistrict && otherDistrict !== district.id && !candidate.isNPP)
        throw new Error("A candidate may contest only one Shugiin constituency");
      if (!otherDistrict) ownerDistrict.set(candidate.candidateId, district.id);
    }
    const ordered = [...candidates].sort(
      (left, right) => right.votes - left.votes || left.candidateId.localeCompare(right.candidateId)
    );
    const winner = ordered[0]?.candidateId ?? null;
    directWinners[district.id] = winner;
    if (winner) seatsByCandidate[winner]++;
  }

  const electedDirect = new Set(
    Object.values(directWinners).filter((id): id is string => id != null)
  );
  const partySeatsByRegion: Record<string, Record<string, number>> = {};
  const listWinners: Record<string, string[]> = {};
  const vacancies: string[] = [];
  const listCandidateRegion = new Map<string, string>();
  for (const activeRegion of activeRegions) {
    const capacity = JP_SHUGIIN_1994_LIST_SEATS[activeRegion];
    const votes = ballots.listVotesByRegion[activeRegion];
    const slate = ballots.regionalLists[activeRegion];
    if (!votes || !slate) throw new Error(`Missing regional party-list ballot ${activeRegion}`);
    const parties = new Set([...Object.keys(votes), ...slate.map((row) => row.partyId)]);
    const listCandidateIds = new Set<string>();
    const listRanks = new Set<string>();
    for (const row of slate) {
      if (
        !row.candidateId ||
        !row.partyId ||
        row.partyId === "independent" ||
        !Number.isSafeInteger(row.listOrder) ||
        row.listOrder < 1 ||
        listCandidateIds.has(row.candidateId)
      ) {
        throw new Error(`Invalid party-list nominee in ${activeRegion}`);
      }
      const knownParty = partyByCandidate.get(row.candidateId);
      if (knownParty && knownParty !== row.partyId)
        throw new Error("A Shugiin candidate cannot change party between ballots");
      partyByCandidate.set(row.candidateId, row.partyId);
      const rankKey = `${row.partyId}:${row.listOrder}`;
      if (listRanks.has(rankKey)) throw new Error(`Duplicate party-list rank in ${activeRegion}`);
      listRanks.add(rankKey);
      const priorRegion = listCandidateRegion.get(row.candidateId);
      if (priorRegion && priorRegion !== activeRegion && row.isNPP !== true)
        throw new Error("A player candidate may appear on only one Shugiin regional list");
      if (!priorRegion) listCandidateRegion.set(row.candidateId, activeRegion);
      listCandidateIds.add(row.candidateId);
      seatsByCandidate[row.candidateId] ??= 0;
    }
    const partyVotes = new Map<string, number>();
    for (const partyId of parties) {
      const partyVote = votes[partyId] ?? 0;
      if (!Number.isSafeInteger(partyVote) || partyVote < 0)
        throw new Error(`Invalid regional party-list votes in ${activeRegion}`);
      partyVotes.set(partyId, partyVote);
    }
    const allocation: Record<string, number> = Object.fromEntries(
      [...parties].map((id) => [id, 0])
    );
    for (let seat = 0; seat < capacity; seat++) {
      const ordered = [...parties].sort((left, right) => {
        const quotientLeft = (partyVotes.get(left) ?? 0) / (allocation[left] + 1);
        const quotientRight = (partyVotes.get(right) ?? 0) / (allocation[right] + 1);
        return quotientRight - quotientLeft || left.localeCompare(right);
      });
      const winner = ordered[0];
      if (!winner || (partyVotes.get(winner) ?? 0) === 0) break;
      allocation[winner]++;
    }
    partySeatsByRegion[activeRegion] = allocation;
    listWinners[activeRegion] = [];
    for (const [partyId, seats] of Object.entries(allocation)) {
      const nominees = slate
        .filter(
          (row) =>
            row.partyId === partyId && (row.isNPP === true || !electedDirect.has(row.candidateId))
        )
        .sort(
          (left, right) =>
            left.listOrder - right.listOrder || left.candidateId.localeCompare(right.candidateId)
        );
      for (let index = 0; index < seats; index++) {
        const nominee = nominees[index] ?? nominees.find((row) => row.isNPP === true);
        if (!nominee) {
          vacancies.push(`${activeRegion}:${partyId}:${index + 1}`);
          continue;
        }
        seatsByCandidate[nominee.candidateId]++;
        listWinners[activeRegion].push(nominee.candidateId);
      }
    }
  }
  return {
    totalSeats:
      activeDistricts.length +
      activeRegions.reduce((sum, id) => sum + JP_SHUGIIN_1994_LIST_SEATS[id], 0),
    districtSeats: activeDistricts.length,
    listSeats: activeRegions.reduce((sum, id) => sum + JP_SHUGIIN_1994_LIST_SEATS[id], 0),
    seatsByCandidate,
    partySeatsByRegion,
    directWinners,
    listWinners,
    vacancies,
  };
}
