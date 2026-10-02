/**
 * Bulgaria's ordinary Assembly combines five campaign inputs into 31 district
 * lists and a national allocation. buildBgOrdinaryElectionPlan conserves party
 * votes, permits one mandate per player and uses existing NPC list capacity.
 */
import { BG_1991_ELECTORAL_DISTRICTS } from "../data/electoralDistricts1991";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";
import { BG_ORDINARY_DISTRICT_SEATS } from "./assemblyTransition";
import { bgNationalOrdinaryQuotas } from "./nationalOrdinaryAllocation";
import { bgBalancedDistrictLists } from "./districtListAllocation";

export interface BgOrdinaryNominee {
  id: string;
  ownerId: string;
  party: string;
  votes: number;
  listOrder: number;
  isNpc: boolean;
  eligible: boolean;
  /** Optional explicit district choice; otherwise one stable bounded assignment. */
  independentDistrictId?: string;
}
export interface BgOrdinaryRace {
  electionId: string;
  regionId: string;
  candidates: readonly BgOrdinaryNominee[];
}
export interface BgOrdinaryElectionPlan {
  kind: "allocated";
  ruleVersion: "ordinary-31-v1";
  partySeats: Record<string, number>;
  independentSeats: number;
  regionCapacity: Record<string, number>;
  districtSeats: Record<string, Record<string, number>>;
  candidateSeatsByElection: Record<string, Record<string, number>>;
  candidateDistricts: Record<string, string>;
}
export type BgOrdinaryPlanOutcome =
  | BgOrdinaryElectionPlan
  | {
      kind: "deferred";
      reason:
        | "no-eligible-party-lists"
        | "insufficient-district-list-support"
        | "insufficient-viable-list-capacity";
    };

function stableIndex(id: string, count: number): number {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash % count;
}

/**
 * Party support is split by district population with all party votes conserved.
 * An independent runs in one chosen or deterministic district and receives only
 * that district's share of their regional campaign baseline, as in the bounded
 * Hungarian district model. The remaining baseline is not a second candidacy.
 * District city subdivision estimates are explicitly described in the catalog.
 */
export function buildBgOrdinaryElectionPlan(
  races: readonly BgOrdinaryRace[]
): BgOrdinaryPlanOutcome {
  const districts = BG_1991_ELECTORAL_DISTRICTS;
  const regionIds = [...new Set(districts.map((row) => row.regionId))];
  if (
    races.length !== regionIds.length ||
    new Set(races.map((row) => row.regionId)).size !== regionIds.length ||
    new Set(races.map((row) => row.electionId)).size !== races.length ||
    races.some((row) => !row.electionId || !regionIds.includes(row.regionId))
  )
    throw new Error("Bulgarian ordinary ballot coverage is incomplete");
  const byRegion = new Map(races.map((row) => [row.regionId, row]));
  const capacities = BG_ORDINARY_DISTRICT_SEATS;
  const districtVotes: Record<string, Record<string, number>> = Object.fromEntries(
    districts.map((row) => [row.id, {}])
  );
  const partyVotes: Record<string, number> = {};
  const candidateDistricts: Record<string, string> = {};
  const candidateSeatsByElection: Record<string, Record<string, number>> = {};
  const regionCapacity: Record<string, number> = {};
  const seenCandidates = new Set<string>(),
    seenOwners = new Set<string>();
  const independents: Array<{
    candidate: BgOrdinaryNominee;
    electionId: string;
    districtId: string;
    votes: number;
  }> = [];
  let totalValidVotes = 0;
  for (const regionId of [...regionIds].sort()) {
    const race = byRegion.get(regionId)!;
    if (race.candidates.length === 0)
      throw new Error("Bulgarian regional ballot has no candidates");
    const localDistricts = districts.filter((row) => row.regionId === regionId);
    const weights = Object.fromEntries(localDistricts.map((row) => [row.id, row.population]));
    regionCapacity[regionId] = localDistricts.reduce((sum, row) => sum + capacities[row.id], 0);
    candidateSeatsByElection[race.electionId] = {};
    for (const candidate of race.candidates) {
      if (
        !candidate.id ||
        !candidate.ownerId ||
        !candidate.party ||
        seenCandidates.has(candidate.id) ||
        seenOwners.has(`${candidate.isNpc ? "npc" : "player"}:${candidate.ownerId}`) ||
        !Number.isSafeInteger(candidate.votes) ||
        candidate.votes < 0 ||
        !Number.isFinite(candidate.listOrder)
      )
        throw new Error("Invalid or duplicated Bulgarian nominee identity or votes");
      seenCandidates.add(candidate.id);
      seenOwners.add(`${candidate.isNpc ? "npc" : "player"}:${candidate.ownerId}`);
      candidateSeatsByElection[race.electionId][candidate.id] = 0;
      const split = apportionSeats(candidate.votes, weights);
      if (candidate.party === "independent") {
        const districtId =
          candidate.independentDistrictId ??
          localDistricts[stableIndex(candidate.id, localDistricts.length)].id;
        if (!localDistricts.some((row) => row.id === districtId))
          throw new Error("Independent's district is outside their region");
        candidateDistricts[candidate.id] = districtId;
        independents.push({
          candidate,
          electionId: race.electionId,
          districtId,
          votes: split[districtId],
        });
        totalValidVotes += split[districtId];
      } else {
        partyVotes[candidate.party] = (partyVotes[candidate.party] ?? 0) + candidate.votes;
        totalValidVotes += candidate.votes;
        for (const [districtId, votes] of Object.entries(split))
          districtVotes[districtId][candidate.party] =
            (districtVotes[districtId][candidate.party] ?? 0) + votes;
      }
      if (!Number.isSafeInteger(totalValidVotes))
        throw new Error("Bulgarian ballot vote total overflows");
    }
  }
  if (totalValidVotes === 0) throw new Error("Bulgarian ordinary election has no valid votes");
  const independentByDistrict = new Map<string, typeof independents>();
  for (const row of independents) {
    const group = independentByDistrict.get(row.districtId) ?? [];
    group.push(row);
    independentByDistrict.set(row.districtId, group);
  }
  const independentWinners: Record<string, Record<string, number>> = {};
  let independentSeats = 0;
  for (const district of districts) {
    const entries = independentByDistrict.get(district.id) ?? [];
    const valid =
      Object.values(districtVotes[district.id]).reduce((sum, votes) => sum + votes, 0) +
      entries.reduce((sum, row) => sum + row.votes, 0);
    const quota = valid / capacities[district.id];
    independentWinners[district.id] = {};
    for (const row of entries.sort(
      (a, b) => b.votes - a.votes || a.candidate.id.localeCompare(b.candidate.id)
    )) {
      if (!row.candidate.eligible || row.votes <= 0 || row.votes < quota) continue;
      if (Object.keys(independentWinners[district.id]).length >= capacities[district.id]) break;
      independentWinners[district.id][row.candidate.id] = 1;
      candidateSeatsByElection[row.electionId][row.candidate.id] = 1;
      independentSeats++;
    }
  }
  const national = bgNationalOrdinaryQuotas({
    partyVotes,
    totalValidVotes,
    totalSeats: 240,
    independentSeats,
  });
  if (national.unallocatedSeats > 0) return { kind: "deferred", reason: "no-eligible-party-lists" };
  const allocation = bgBalancedDistrictLists(
    districts.map((row) => ({
      id: row.id,
      seats: capacities[row.id] - Object.keys(independentWinners[row.id]).length,
      partyVotes: districtVotes[row.id],
    })),
    national.partySeats
  );
  if (allocation.kind === "deferred") return allocation;
  for (const [regionId, race] of byRegion) {
    const localDistricts = districts.filter((row) => row.regionId === regionId);
    for (const party of national.eligibleParties) {
      let remaining = localDistricts.reduce(
        (sum, row) => sum + allocation.seatsByDistrict[row.id][party],
        0
      );
      const list = race.candidates
        .filter((row) => row.party === party && row.eligible)
        .sort((a, b) => a.listOrder - b.listOrder || a.id.localeCompare(b.id));
      for (const candidate of list) {
        const seats = candidate.isNpc ? remaining : Math.min(1, remaining);
        candidateSeatsByElection[race.electionId][candidate.id] = seats;
        remaining -= seats;
        if (remaining === 0) break;
      }
      if (remaining > 0) return { kind: "deferred", reason: "insufficient-viable-list-capacity" };
    }
  }
  const districtSeats = Object.fromEntries(
    districts.map((row) => [
      row.id,
      {
        ...allocation.seatsByDistrict[row.id],
        ...Object.fromEntries(
          Object.keys(independentWinners[row.id]).map((id) => [`independent:${id}`, 1])
        ),
      },
    ])
  );
  return {
    kind: "allocated",
    ruleVersion: "ordinary-31-v1",
    partySeats: national.partySeats,
    independentSeats,
    regionCapacity,
    districtSeats,
    candidateSeatsByElection,
    candidateDistricts,
  };
}

/**
 * At handover, unavailable list nominees yield to the next existing list member.
 * National party quotas and all district mandates stay frozen. An unavailable
 * independent cannot donate their personal mandate to a party or another person.
 */
export function settleBgOrdinaryListHolders(
  plan: BgOrdinaryElectionPlan,
  races: readonly BgOrdinaryRace[]
):
  | { kind: "allocated"; candidateSeatsByElection: Record<string, Record<string, number>> }
  | { kind: "deferred"; reason: "unavailable-independent" | "insufficient-viable-list-capacity" } {
  const result: Record<string, Record<string, number>> = {};
  for (const [electionId, allocation] of Object.entries(plan.candidateSeatsByElection)) {
    const race = races.find((row) => row.electionId === electionId);
    if (!race) throw new Error("Bulgarian handover ballot is missing");
    const candidates = new Map(race.candidates.map((row) => [row.id, row]));
    result[electionId] = Object.fromEntries(Object.keys(allocation).map((id) => [id, 0]));
    const partySeats: Record<string, number> = {};
    for (const [id, seats] of Object.entries(allocation)) {
      const nominee = candidates.get(id);
      if (!nominee) throw new Error("Frozen Bulgarian nominee identity is missing");
      if (nominee.party === "independent") {
        if (seats > 0 && !nominee.eligible)
          return { kind: "deferred", reason: "unavailable-independent" };
        result[electionId][id] = seats;
      } else partySeats[nominee.party] = (partySeats[nominee.party] ?? 0) + seats;
    }
    for (const [party, quota] of Object.entries(partySeats)) {
      let remaining = quota;
      const list = race.candidates
        .filter((row) => row.party === party && row.eligible && row.id in allocation)
        .sort((a, b) => a.listOrder - b.listOrder || a.id.localeCompare(b.id));
      for (const nominee of list) {
        const seats = nominee.isNpc ? remaining : Math.min(1, remaining);
        result[electionId][nominee.id] = seats;
        remaining -= seats;
        if (remaining === 0) break;
      }
      if (remaining > 0) return { kind: "deferred", reason: "insufficient-viable-list-capacity" };
    }
  }
  return { kind: "allocated", candidateSeatsByElection: result };
}
