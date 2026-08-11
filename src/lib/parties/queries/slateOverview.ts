import type { CountryId } from "@/lib/constants/countries";
import { listPartySlates, listSlateCandidatesByIds } from "@/lib/db/recruitmentSlateLookup";
import type { Election } from "@/lib/db/types";
import type { PartySlateOverviewResponse } from "@/lib/parties/dto/partyView";
import type { Db } from "mongodb";

function countByStatus(rows: { status: string }[]) {
  const counts = { invited: 0, considering: 0, accepted: 0, declined: 0, withdrawn: 0, filed: 0 };
  for (const row of rows) {
    if (row.status in counts) counts[row.status as keyof typeof counts] += 1;
  }
  return counts;
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

export async function getPartySlateOverview(
  db: Db,
  {
    countryId,
    partyId,
    includeArchived,
  }: {
    countryId: CountryId;
    partyId: string;
    includeArchived: boolean;
  }
): Promise<PartySlateOverviewResponse> {
  const elections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      status: includeArchived
        ? { $in: ["upcoming", "active", "completed", "resolved"] }
        : { $in: ["upcoming", "active"] },
    })
    .project<{
      _id: Election["_id"];
      electionType: string;
      state: string;
      senateClass?: Election["senateClass"];
      chamberClass?: Election["chamberClass"];
      status: string;
      cycle: number;
      primaryEndTime?: Date;
    }>({
      _id: 1,
      electionType: 1,
      state: 1,
      senateClass: 1,
      chamberClass: 1,
      status: 1,
      cycle: 1,
      primaryEndTime: 1,
    })
    .toArray();

  const eligibleElections = elections
    .filter((election) => election.electionType !== "president")
    .sort((left, right) => {
      if (left.state !== right.state) return left.state.localeCompare(right.state);
      const weightDiff =
        getSlateElectionSortWeight(left.electionType) -
        getSlateElectionSortWeight(right.electionType);
      if (weightDiff !== 0) return weightDiff;

      const leftClass = left.senateClass ?? left.chamberClass ?? 0;
      const rightClass = right.senateClass ?? right.chamberClass ?? 0;
      if (leftClass !== rightClass) return leftClass - rightClass;

      return left.electionType.localeCompare(right.electionType);
    });

  const slates = await listPartySlates(db, countryId, partyId, { includeArchived });
  const slateByElectionId = new Map(slates.map((slate) => [slate.electionId.toString(), slate]));
  const candidates = await listSlateCandidatesByIds(
    db,
    slates.map((slate) => slate._id)
  );
  const candidatesBySlate = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const key = candidate.slateId.toString();
    const list = candidatesBySlate.get(key) ?? [];
    list.push(candidate);
    candidatesBySlate.set(key, list);
  }

  const items = eligibleElections.map((election) => {
    const slate = slateByElectionId.get(election._id.toString());
    const slateCandidates = slate ? (candidatesBySlate.get(slate._id.toString()) ?? []) : [];
    return {
      id: slate?._id.toString() ?? null,
      electionId: election._id.toString(),
      electionType: election.electionType,
      senateClass: election.senateClass ?? null,
      chamberClass: election.chamberClass ?? null,
      electionStatus: election.status ?? null,
      electionCycle: election.cycle ?? null,
      electionPrimaryEndTime: election.primaryEndTime?.toISOString() ?? null,
      state: election.state,
      priority: slate?.priority ?? "none",
      notes: slate?.notes ?? null,
      archivedAt: slate?.archivedAt?.toISOString() ?? null,
      candidateCounts: countByStatus(slateCandidates),
      createdAt: slate?.createdAt.toISOString() ?? null,
      updatedAt: slate?.updatedAt.toISOString() ?? null,
    };
  });

  const aggregateByState = new Map<
    string,
    {
      state: string;
      slateCount: number;
      byStatus: { invited: number; accepted: number; declined: number; filed: number };
      highPriority: number;
      contested: number;
    }
  >();

  for (const item of items) {
    const aggregate = aggregateByState.get(item.state) ?? {
      state: item.state,
      slateCount: 0,
      byStatus: { invited: 0, accepted: 0, declined: 0, filed: 0 },
      highPriority: 0,
      contested: 0,
    };
    aggregate.slateCount += 1;
    aggregate.byStatus.invited += item.candidateCounts.invited;
    aggregate.byStatus.accepted += item.candidateCounts.accepted;
    aggregate.byStatus.declined += item.candidateCounts.declined;
    aggregate.byStatus.filed += item.candidateCounts.filed;
    if (item.priority === "high") aggregate.highPriority += 1;
    if (item.priority === "primary_threat" || item.priority === "defend") {
      aggregate.contested += 1;
    }
    aggregateByState.set(item.state, aggregate);
  }

  return {
    items,
    stateAggregates: Array.from(aggregateByState.values()),
  };
}
