/**
 * Shared election-night helpers — Commons, US House, Bundestag, Shūgiin, etc.
 *
 * Single entry point for:
 *  - which race types get a national board
 *  - picking an anchor election on a country elections page
 *  - chamber titles / majority style
 *  - building the national seat aggregation (used by the results API)
 *
 * Display math (unit calls, final-hour drip, projection kind) lives in
 * `computeResults.ts`; this module is the election-night façade both the
 * `/elections/[id]/results` page and country-list embeds should go through.
 */
import type { Db } from "mongodb";
import type { Election, ElectionVoteTally } from "@/lib/db/types";
import { computeSeatEstimates } from "@/lib/elections/buildPollingData";
import type { MajoritarianBonusConfig } from "@/lib/turn/election/seatAllocation";
import {
  CHAMBER_LABELS,
  NATIONAL_AGGREGATION_TYPES,
  WESTMINSTER_STYLE_TYPES,
  computeNationalProjection,
  unitRevealOffset,
} from "./computeResults";
import type { NationalParty, NationalRegion, NationalResults } from "./types";

export {
  CHAMBER_LABELS,
  NATIONAL_AGGREGATION_TYPES,
  WESTMINSTER_STYLE_TYPES,
  computeNationalProjection,
} from "./computeResults";

const ENDED_STATUSES = new Set(["completed", "resolved", "cancelled"]);
const INDEPENDENT_COLOR = "#9CA3AF";

export interface ElectionNightPartyInfo {
  name: string;
  abbreviation: string;
  color: string;
}

export interface ElectionNightAnchorCandidate {
  id: string;
  electionType: string;
  status: string;
}

/** True when this election type participates in the national election-night board. */
export function isElectionNightType(electionType: string): boolean {
  return NATIONAL_AGGREGATION_TYPES.has(electionType);
}

/**
 * Prefer an active national multi-seat race; fall back to a completed/resolved
 * one. Shared by country elections embeds (UK Commons, US House, …).
 */
export function pickElectionNightAnchor(
  elections: ElectionNightAnchorCandidate[]
): ElectionNightAnchorCandidate | null {
  const eligible = elections.filter((e) => isElectionNightType(e.electionType));
  return (
    eligible.find((e) => e.status === "active") ??
    eligible.find((e) => e.status === "completed" || e.status === "resolved") ??
    null
  );
}

/** Human title for the election-night chrome (embed header / results page). */
export function electionNightTitle(electionType: string): string {
  const chamber = CHAMBER_LABELS[electionType];
  return chamber ? `Election Night · ${chamber}` : "Election Night";
}

export function electionNightStyle(electionType: string): "westminster" | "generic" {
  return WESTMINSTER_STYLE_TYPES.has(electionType) ? "westminster" : "generic";
}

export function majorityThreshold(totalSeats: number): number {
  return Math.floor(totalSeats / 2) + 1;
}

async function loadRegionNames(db: Db, regionIds: string[]): Promise<Map<string, string>> {
  if (regionIds.length === 0) return new Map();
  const docs = await db
    .collection<{ _id: string; name?: string }>("states")
    .find({ _id: { $in: regionIds } })
    .project<{ _id: string; name?: string }>({ name: 1 })
    .toArray();
  return new Map(docs.map((d) => [d._id, d.name ?? d._id]));
}

function partyInfo(
  map: Map<string, ElectionNightPartyInfo>,
  partyId: string
): ElectionNightPartyInfo {
  return (
    map.get(partyId) ?? {
      name: "Independent",
      abbreviation: "IND",
      color: INDEPENDENT_COLOR,
    }
  );
}

/**
 * National seat aggregation across sibling region elections of the same
 * type + cycle. Regions "declare" one by one across the final hour via
 * deterministic reveal offsets. Shared by every national multi-seat night
 * (Commons, House, Bundestag, …).
 */
export async function buildNationalElectionNight(
  db: Db,
  election: Election,
  partyMap: Map<string, ElectionNightPartyInfo>,
  finalHourProgress: number | null,
  isEnded: boolean,
  majoritarianBonus?: MajoritarianBonusConfig,
  // Ticket #1032: the FPTP boost keys on each region's own party-organization
  // ranking, so a single shared config is wrong across siblings — pass the
  // per-region rankings (loadCommonsOrgRankings) alongside the base config.
  orgRankingByState?: Map<string, string[]>
): Promise<NationalResults | null> {
  const electionType = election.electionType;
  if (!NATIONAL_AGGREGATION_TYPES.has(electionType)) return null;

  const siblings = (await db
    .collection<Election>("elections")
    .find(
      { countryId: election.countryId, electionType, cycle: election.cycle },
      { projection: { state: 1, totalSeats: 1, status: 1 } }
    )
    .toArray()) as Pick<Election, "_id" | "state" | "totalSeats" | "status">[];
  if (siblings.length < 2) return null;

  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find({ electionId: { $in: siblings.map((s) => s._id) } })
    .project<
      Pick<
        ElectionVoteTally,
        "electionId" | "state" | "totalVotes" | "candidateParties" | "seatsEstimate" | "finalized"
      >
    >({
      electionId: 1,
      state: 1,
      totalVotes: 1,
      candidateParties: 1,
      seatsEstimate: 1,
      finalized: 1,
    })
    .toArray();
  const tallyByElection = new Map(tallies.map((t) => [t.electionId.toString(), t]));

  const regionNames = await loadRegionNames(db, [...new Set(siblings.map((s) => s.state))]);

  const projectedByParty: Record<string, number> = {};
  const declaredByParty: Record<string, number> = {};
  const regions: NationalRegion[] = [];
  let regionsDeclared = 0;
  let totalSeats = 0;

  for (const sibling of siblings) {
    const sid = sibling._id.toString();
    const tally = tallyByElection.get(sid);
    const seats = sibling.totalSeats ?? 0;
    totalSeats += seats;

    const seatsByParty: Record<string, number> = {};
    if (tally) {
      const activeIds = new Set(Object.keys(tally.totalVotes ?? {}));
      const estimate =
        tally.seatsEstimate ??
        computeSeatEstimates(
          electionType,
          seats,
          tally as unknown as ElectionVoteTally,
          activeIds,
          majoritarianBonus && orgRankingByState?.get(sibling.state)?.length
            ? { ...majoritarianBonus, orgRanking: orgRankingByState.get(sibling.state) }
            : majoritarianBonus
        ) ??
        {};
      for (const [cid, seatCount] of Object.entries(estimate)) {
        if (seatCount <= 0) continue;
        const party = tally.candidateParties?.[cid] ?? "independent";
        seatsByParty[party] = (seatsByParty[party] ?? 0) + seatCount;
      }
    }

    const siblingEnded = ENDED_STATUSES.has(sibling.status);
    const declared =
      isEnded ||
      siblingEnded ||
      (finalHourProgress != null && finalHourProgress >= unitRevealOffset(sid, sibling.state));
    if (declared) regionsDeclared++;

    for (const [party, seatCount] of Object.entries(seatsByParty)) {
      projectedByParty[party] = (projectedByParty[party] ?? 0) + seatCount;
      if (declared) declaredByParty[party] = (declaredByParty[party] ?? 0) + seatCount;
    }

    regions.push({
      electionId: sid,
      name: regionNames.get(sibling.state) ?? sibling.state,
      seats,
      declared,
      seatsByParty,
    });
  }

  const parties: NationalParty[] = Object.keys(projectedByParty)
    .map((party) => {
      const info = partyInfo(partyMap, party);
      return {
        party,
        name: info.name,
        abbreviation: info.abbreviation,
        color: info.color,
        declaredSeats: declaredByParty[party] ?? 0,
        projectedSeats: projectedByParty[party] ?? 0,
      };
    })
    .sort((a, b) => b.projectedSeats - a.projectedSeats);

  const style = electionNightStyle(electionType);
  const threshold = majorityThreshold(totalSeats);
  regions.sort((a, b) => a.name.localeCompare(b.name));

  return {
    style,
    chamberLabel: CHAMBER_LABELS[electionType] ?? "Legislature",
    totalSeats,
    majorityThreshold: threshold,
    regionsDeclared,
    totalRegions: regions.length,
    parties,
    regions,
    projection: computeNationalProjection(parties, threshold, style),
  };
}
