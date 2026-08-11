import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Election, SlateCandidate } from "@/lib/db/types";
import { listPartySlates, listSlateCandidatesByIds } from "@/lib/db/recruitmentSlateLookup";
import { partyUrl } from "@/lib/urls";
import { formatElectionTypeLabel } from "@/lib/utils/electionLabels";
import type {
  PartyAnalyticsSlateCoverageItem,
  PartyAnalyticsSlateItem,
  PartyAnalyticsSlateSection,
} from "./types";

interface ElectionSummary {
  electionId: string;
  state: string;
  electionLabel: string;
}

function getSlateElectionSortWeight(electionType: string): number {
  switch (electionType) {
    case "senate":
    case "sangiin":
    case "lords":
    case "seanad":
    case "bundesrat":
      return 10;
    case "house":
    case "commons":
    case "bundestag":
    case "shugiin":
    case "dail":
    case "chamber":
    case "npc":
    case "npcDelegate":
    case "supremeSovietDeputy":
    case "nationalitiesDeputy":
      return 20;
    case "governor":
    case "ministerPresident":
    case "premier":
      return 30;
    case "stateSenate":
    case "regionalCouncil":
    case "holyrood":
    case "senedd":
    case "landtag":
    case "peoplesCongress":
    case "republicSupremeSoviet":
    case "localCouncil":
      return 40;
    default:
      return 50;
  }
}

function formatElectionLabel(
  electionType: string,
  chamberClass?: number | null,
  senateClass?: number | null,
  countryId?: CountryId
): string {
  const baseLabel = formatElectionTypeLabel(electionType, countryId);
  const electionClass = senateClass ?? chamberClass ?? null;
  return electionClass ? `${baseLabel} Class ${electionClass}` : baseLabel;
}

function buildSlateHref(countryId: CountryId, partyId: string, state?: string): string {
  const base = `${partyUrl(countryId, partyId)}?tab=slate`;
  return state ? `${base}&state=${encodeURIComponent(state)}` : base;
}

function buildSlateStateItem(
  election: ElectionSummary,
  statusLabel: string,
  href: string
): PartyAnalyticsSlateItem {
  return {
    electionId: election.electionId,
    state: election.state,
    electionLabel: election.electionLabel,
    statusLabel,
    href,
  };
}

function countStatuses(rows: SlateCandidate[]) {
  return rows.reduce(
    (totals, row) => {
      if (row.status in totals) {
        totals[row.status as keyof typeof totals] += 1;
      }
      return totals;
    },
    { invited: 0, considering: 0, accepted: 0, declined: 0, withdrawn: 0, filed: 0 }
  );
}

export async function buildPartySlateAnalytics(
  db: Db,
  countryId: CountryId,
  partyId: string,
  stateId?: string
): Promise<PartyAnalyticsSlateSection> {
  const elections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      status: { $in: ["upcoming", "active"] },
      ...(stateId ? { state: stateId } : {}),
    })
    .project<Pick<Election, "_id" | "electionType" | "state" | "senateClass" | "chamberClass">>({
      _id: 1,
      electionType: 1,
      state: 1,
      senateClass: 1,
      chamberClass: 1,
    })
    .toArray();

  const eligibleElections = elections
    .filter((election) => election.electionType !== "president")
    .sort((a, b) => {
      if (a.state !== b.state) return a.state.localeCompare(b.state);
      const weightDiff =
        getSlateElectionSortWeight(a.electionType) - getSlateElectionSortWeight(b.electionType);
      if (weightDiff !== 0) return weightDiff;
      const aClass = a.senateClass ?? a.chamberClass ?? 0;
      const bClass = b.senateClass ?? b.chamberClass ?? 0;
      if (aClass !== bClass) return aClass - bClass;
      return a.electionType.localeCompare(b.electionType);
    });

  const slates = await listPartySlates(db, countryId, partyId);
  const slateCandidates = await listSlateCandidatesByIds(
    db,
    slates.map((slate) => slate._id)
  );
  const rowsByElectionId = new Map<string, SlateCandidate[]>();
  for (const row of slateCandidates) {
    const key = row.electionId.toString();
    const list = rowsByElectionId.get(key) ?? [];
    list.push(row);
    rowsByElectionId.set(key, list);
  }

  const byState = new Map<string, PartyAnalyticsSlateCoverageItem>();
  const noCoverage: PartyAnalyticsSlateItem[] = [];
  const atRiskAssignments: PartyAnalyticsSlateItem[] = [];
  let awaitingResolutionCount = 0;
  let filedCount = 0;
  let likelyDeclineCount = 0;

  for (const election of eligibleElections) {
    const electionId = election._id.toString();
    const rows = rowsByElectionId.get(electionId) ?? [];
    const liveRows = rows.filter((row) => row.status !== "withdrawn");
    const counts = countStatuses(rows);
    awaitingResolutionCount += counts.invited + counts.considering + counts.accepted;
    filedCount += counts.filed;

    const stateHref = buildSlateHref(countryId, partyId, election.state);
    const stateBucket = byState.get(election.state) ?? {
      state: election.state,
      totalRaces: 0,
      coveredRaces: 0,
      filedRaces: 0,
      openRaces: 0,
      likelyDeclines: 0,
      href: stateHref,
    };
    stateBucket.totalRaces += 1;
    if (liveRows.length > 0) stateBucket.coveredRaces += 1;
    if (counts.filed > 0) stateBucket.filedRaces += 1;
    if (liveRows.length === 0) stateBucket.openRaces += 1;
    byState.set(election.state, stateBucket);

    const summary: ElectionSummary = {
      electionId,
      state: election.state,
      electionLabel: formatElectionLabel(
        election.electionType,
        election.chamberClass ?? null,
        election.senateClass ?? null,
        countryId
      ),
    };

    if (liveRows.length === 0) {
      noCoverage.push(buildSlateStateItem(summary, "No assignment", stateHref));
    }

    const riskRows = liveRows.filter(
      (row) =>
        (row.status === "invited" || row.status === "considering") && row.refusalReason !== null
    );
    likelyDeclineCount += riskRows.length;
    stateBucket.likelyDeclines += riskRows.length;
    for (const row of riskRows) {
      atRiskAssignments.push(
        buildSlateStateItem(summary, `Likely decline: ${row.candidateName}`, stateHref)
      );
    }
  }

  const coverageItems = Array.from(byState.values());

  return {
    activeRaceCount: eligibleElections.length,
    uncoveredRaceCount: noCoverage.length,
    awaitingResolutionCount,
    filedCount,
    likelyDeclineCount,
    statesNeedingCoverageCount: coverageItems.filter((item) => item.openRaces > 0).length,
    statesWithLikelyDeclinesCount: coverageItems.filter((item) => item.likelyDeclines > 0).length,
    noCoverage: noCoverage.slice(0, 6),
    atRiskAssignments: atRiskAssignments.slice(0, 6),
    stateCoverage: coverageItems
      .sort(
        (a, b) =>
          b.openRaces - a.openRaces ||
          b.likelyDeclines - a.likelyDeclines ||
          b.totalRaces - a.totalRaces
      )
      .slice(0, 6),
  };
}
