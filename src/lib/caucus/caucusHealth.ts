import { ObjectId, type Db } from "mongodb";
import type {
  Caucus,
  CaucusChairCandidate,
  CaucusChairElection,
  CaucusChairVote,
  CaucusMembership,
  Character,
  NPP,
  NPPRelationship,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP } from "@/lib/constants/partyOrg";
import {
  buildWhipDefianceSnapshot,
  type WhipDefianceSnapshot,
} from "@/lib/partyWhips/whipDefiance";

const CAUCUS_RECENT_WINDOW_TURNS = 12;
const CAUCUS_WARNING_BUFFER = 10;

export type CaucusHealthStatusLabel = "Healthy" | "Strained" | "Fragile";

export interface CaucusHealthAtRiskMember {
  nppId: string;
  nppName: string;
  relationshipWithChair: number;
  gapFromExit: number;
  exitRiskLabel: "Critical" | "Elevated" | "Watch";
  href: string;
}

export interface CaucusHealthChurnItem {
  id: string;
  memberId: string;
  memberType: "character" | "npp";
  memberName: string;
  kind: "join" | "leave" | "forced_exit";
  occurredAt: string;
}

export interface CaucusHealthElectionSummary {
  status: "active" | "idle" | "recently_completed";
  electionId: string | null;
  candidateCount: number;
  totalVotes: number;
  endTurn: number | null;
  endTime: string | null;
  winnerId: string | null;
  winnerName: string | null;
}

export interface CaucusHealthItem {
  caucusId: string;
  caucusSlug: string;
  caucusName: string;
  statusLabel: CaucusHealthStatusLabel;
  statusReason: string;
  chairId: string | null;
  chairName: string | null;
  chairVacant: boolean;
  memberCounts: { players: number; npps: number; total: number };
  activeDefianceCount: number;
  playerDefianceCount: number;
  nppDefianceCount: number;
  atRiskCount: number;
  criticalAtRiskCount: number;
  recentJoinCount: number;
  recentLeaveCount: number;
  recentForcedExitCount: number;
  election: CaucusHealthElectionSummary;
  atRiskMembers: CaucusHealthAtRiskMember[];
  recentChurn: CaucusHealthChurnItem[];
  href: string;
}

export interface PartyCaucusHealthSnapshot {
  recentWindowTurns: number;
  healthyCount: number;
  strainedCount: number;
  fragileCount: number;
  activeElectionCount: number;
  chairVacancyCount: number;
  recentJoinCount: number;
  recentLeaveCount: number;
  recentForcedExitCount: number;
  activeDefianceCount: number;
  atRiskMemberCount: number;
  caucuses: CaucusHealthItem[];
}

function buildCaucusHref(countryId: CountryId, partyId: string, caucusSlug: string): string {
  return `/country/${countryId.toLowerCase()}/parties/${partyId}?tab=caucuses&caucus=${encodeURIComponent(
    caucusSlug
  )}`;
}

function buildNppHref(nppId: ObjectId): string {
  return `/politicians/npp/${nppId.toString()}`;
}

function classifyExitRisk(relationshipWithChair: number): "Critical" | "Elevated" | "Watch" {
  if (relationshipWithChair < CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP) return "Critical";
  if (relationshipWithChair < CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP + 5) return "Elevated";
  return "Watch";
}

function getStatusLabel(input: {
  chairVacant: boolean;
  criticalAtRiskCount: number;
  recentForcedExitCount: number;
  activeDefianceCount: number;
  atRiskCount: number;
  recentLeaveCount: number;
  electionActive: boolean;
}): Pick<CaucusHealthItem, "statusLabel" | "statusReason"> {
  if (input.chairVacant) {
    return {
      statusLabel: "Fragile",
      statusReason: "Chair seat is vacant and the caucus needs a new operator.",
    };
  }
  if (input.criticalAtRiskCount > 0) {
    return {
      statusLabel: "Fragile",
      statusReason: `${input.criticalAtRiskCount} NPP caucus member(s) are already below the chair relationship retention floor.`,
    };
  }
  if (input.recentForcedExitCount > 0) {
    return {
      statusLabel: "Fragile",
      statusReason: `${input.recentForcedExitCount} forced exit(s) landed in the last ${CAUCUS_RECENT_WINDOW_TURNS} turns.`,
    };
  }
  if (input.activeDefianceCount >= 3) {
    return {
      statusLabel: "Fragile",
      statusReason: `${input.activeDefianceCount} active defiance cases are piling up in the caucus whip lane.`,
    };
  }
  if (input.atRiskCount > 0) {
    return {
      statusLabel: "Strained",
      statusReason: `${input.atRiskCount} NPP member(s) are close to the relationship exit threshold.`,
    };
  }
  if (input.recentLeaveCount > 0) {
    return {
      statusLabel: "Strained",
      statusReason: `${input.recentLeaveCount} recent voluntary departure(s) suggest churn inside the bloc.`,
    };
  }
  if (input.activeDefianceCount > 0) {
    return {
      statusLabel: "Strained",
      statusReason: `${input.activeDefianceCount} active defiance case(s) need caucus-whip follow-up.`,
    };
  }
  if (input.electionActive) {
    return {
      statusLabel: "Strained",
      statusReason: "A caucus chair election is currently active, so leadership is in flux.",
    };
  }
  return {
    statusLabel: "Healthy",
    statusReason: "Member retention, leadership, and whip discipline all look stable right now.",
  };
}

function countActiveMembers(memberships: CaucusMembership[]) {
  let players = 0;
  let npps = 0;
  for (const membership of memberships) {
    if (membership.status !== "active") continue;
    if (membership.memberType === "character") players += 1;
    else npps += 1;
  }
  return { players, npps, total: players + npps };
}

export async function buildPartyCaucusHealthSnapshot(
  db: Db,
  countryId: CountryId,
  partyId: string
): Promise<PartyCaucusHealthSnapshot> {
  const caucuses = (
    await db
      .collection<Caucus>("caucuses")
      .find({ countryId, partyId, disbandedAt: null })
      .toArray()
  ).sort((a, b) => a.name.localeCompare(b.name));

  if (caucuses.length === 0) {
    return {
      recentWindowTurns: CAUCUS_RECENT_WINDOW_TURNS,
      healthyCount: 0,
      strainedCount: 0,
      fragileCount: 0,
      activeElectionCount: 0,
      chairVacancyCount: 0,
      recentJoinCount: 0,
      recentLeaveCount: 0,
      recentForcedExitCount: 0,
      activeDefianceCount: 0,
      atRiskMemberCount: 0,
      caucuses: [],
    };
  }

  const caucusIds = caucuses.map((caucus) => caucus._id);
  const chairIds = caucuses
    .map((caucus) => caucus.chairId)
    .filter((chairId): chairId is ObjectId => chairId instanceof ObjectId);
  const recentWindowStart = new Date(Date.now() - CAUCUS_RECENT_WINDOW_TURNS * 60 * 60 * 1000);

  const [memberships, elections, chairs, defianceEntries] = await Promise.all([
    db
      .collection<CaucusMembership>("caucusMemberships")
      .find({
        caucusId: { $in: caucusIds },
        status: { $in: ["active", "left", "removed"] },
      })
      .toArray(),
    db
      .collection<CaucusChairElection>("caucusChairElections")
      .find({
        caucusId: { $in: caucusIds },
        status: { $in: ["voting", "completed"] },
      })
      .toArray(),
    chairIds.length === 0
      ? Promise.resolve([] as Character[])
      : db
          .collection<Character>("characters")
          .find({ _id: { $in: chairIds } })
          .toArray(),
    Promise.all(
      caucuses.map(async (caucus): Promise<readonly [string, WhipDefianceSnapshot]> => [
        caucus._id.toString(),
        await buildWhipDefianceSnapshot(db, {
          countryId,
          partyId,
          issuedBy: "caucus",
          caucusId: caucus._id,
        }),
      ])
    ),
  ]);

  const activeNppMemberships = memberships.filter(
    (membership) => membership.status === "active" && membership.memberType === "npp"
  );
  const activeNppIds = activeNppMemberships.map((membership) => membership.memberId);
  const allCharacterIds = memberships
    .filter((membership) => membership.memberType === "character")
    .map((membership) => membership.memberId);
  const allNppIds = memberships
    .filter((membership) => membership.memberType === "npp")
    .map((membership) => membership.memberId);

  const [relationships, npps, characters, candidates, voteCounts] = await Promise.all([
    chairIds.length === 0 || activeNppIds.length === 0
      ? Promise.resolve([] as NPPRelationship[])
      : db
          .collection<NPPRelationship>("nppRelationships")
          .find({
            characterId: { $in: chairIds },
            nppId: { $in: activeNppIds },
          })
          .toArray(),
    allNppIds.length === 0
      ? Promise.resolve([] as NPP[])
      : db
          .collection<NPP>("npps")
          .find({ _id: { $in: allNppIds } })
          .toArray(),
    allCharacterIds.length === 0
      ? Promise.resolve([] as Character[])
      : db
          .collection<Character>("characters")
          .find({ _id: { $in: allCharacterIds } })
          .toArray(),
    elections.length === 0
      ? Promise.resolve([] as CaucusChairCandidate[])
      : db
          .collection<CaucusChairCandidate>("caucusChairCandidates")
          .find({
            electionId: { $in: elections.map((election) => election._id) },
            status: "active",
          })
          .toArray(),
    elections.length === 0
      ? Promise.resolve([] as Array<{ electionId: ObjectId; totalVotes: number }>)
      : db
          .collection<CaucusChairVote>("caucusChairVotes")
          .aggregate<{ electionId: ObjectId; totalVotes: number }>([
            {
              $match: {
                electionId: { $in: elections.map((election) => election._id) },
              },
            },
            {
              $group: {
                _id: "$electionId",
                totalVotes: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                electionId: "$_id",
                totalVotes: 1,
              },
            },
          ])
          .toArray(),
  ]);

  const membershipsByCaucus = new Map<string, CaucusMembership[]>();
  for (const membership of memberships) {
    const key = membership.caucusId.toString();
    const list = membershipsByCaucus.get(key);
    if (list) list.push(membership);
    else membershipsByCaucus.set(key, [membership]);
  }

  const electionByCaucus = new Map<string, CaucusChairElection>();
  for (const election of [...elections].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
  )) {
    const key = election.caucusId.toString();
    if (!electionByCaucus.has(key) || election.status === "voting") {
      electionByCaucus.set(key, election);
    }
  }

  const candidateCountsByElectionId = new Map<string, number>();
  for (const candidate of candidates) {
    const key = candidate.electionId.toString();
    candidateCountsByElectionId.set(key, (candidateCountsByElectionId.get(key) ?? 0) + 1);
  }

  const voteCountsByElectionId = new Map(
    voteCounts.map((entry) => [entry.electionId.toString(), entry.totalVotes])
  );
  const chairNameById = new Map(chairs.map((chair) => [chair._id.toString(), chair.name]));
  const nppById = new Map(npps.map((npp) => [npp._id.toString(), npp]));
  const characterById = new Map(
    characters.map((character) => [character._id.toString(), character])
  );
  const relationshipByKey = new Map(
    relationships.map((relationship) => [
      `${relationship.characterId.toString()}:${relationship.nppId.toString()}`,
      relationship.relationshipScore,
    ])
  );
  const defianceByCaucusId = new Map<string, WhipDefianceSnapshot>(defianceEntries);

  const caucusHealthItems: CaucusHealthItem[] = caucuses.map((caucus) => {
    const caucusId = caucus._id.toString();
    const caucusMemberships = membershipsByCaucus.get(caucusId) ?? [];
    const activeMemberships = caucusMemberships.filter(
      (membership) => membership.status === "active"
    );
    const memberCounts = countActiveMembers(activeMemberships);
    const activeElection = electionByCaucus.get(caucusId) ?? null;
    const defiance = defianceByCaucusId.get(caucusId) ?? {
      activeCount: 0,
      playerCount: 0,
      nppCount: 0,
      items: [],
    };

    const atRiskMembers = activeMemberships
      .filter((membership) => membership.memberType === "npp")
      .map((membership) => {
        const chairId = caucus.chairId?.toString() ?? null;
        const npp = nppById.get(membership.memberId.toString());
        if (!chairId || !npp) return null;
        const relationshipWithChair =
          relationshipByKey.get(`${chairId}:${membership.memberId.toString()}`) ?? 0;
        if (
          relationshipWithChair >=
          CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP + CAUCUS_WARNING_BUFFER
        ) {
          return null;
        }
        return {
          nppId: membership.memberId.toString(),
          nppName: npp.name,
          relationshipWithChair,
          gapFromExit:
            Math.round((relationshipWithChair - CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP) * 10) / 10,
          exitRiskLabel: classifyExitRisk(relationshipWithChair),
          href: buildNppHref(membership.memberId),
        } satisfies CaucusHealthAtRiskMember;
      })
      .filter((item): item is CaucusHealthAtRiskMember => item !== null)
      .sort((a, b) => a.relationshipWithChair - b.relationshipWithChair)
      .slice(0, 5);

    const allChurnItems: CaucusHealthChurnItem[] = [];
    let recentJoinCount = 0;
    let recentLeaveCount = 0;
    let recentForcedExitCount = 0;

    for (const membership of caucusMemberships) {
      const memberName =
        membership.memberType === "character"
          ? (characterById.get(membership.memberId.toString())?.name ?? "Unknown member")
          : (nppById.get(membership.memberId.toString())?.name ?? "Unknown NPP");

      if (membership.joinedAt && membership.joinedAt >= recentWindowStart) {
        recentJoinCount += 1;
        allChurnItems.push({
          id: `${membership._id.toString()}-join`,
          memberId: membership.memberId.toString(),
          memberType: membership.memberType,
          memberName,
          kind: "join",
          occurredAt: membership.joinedAt.toISOString(),
        });
      }

      if (membership.leftAt && membership.leftAt >= recentWindowStart) {
        const kind: CaucusHealthChurnItem["kind"] =
          membership.status === "removed" || membership.memberType === "npp"
            ? "forced_exit"
            : "leave";
        if (kind === "forced_exit") recentForcedExitCount += 1;
        else recentLeaveCount += 1;
        allChurnItems.push({
          id: `${membership._id.toString()}-left`,
          memberId: membership.memberId.toString(),
          memberType: membership.memberType,
          memberName,
          kind,
          occurredAt: membership.leftAt.toISOString(),
        });
      }
    }

    const recentChurn = allChurnItems
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .slice(0, 6);

    const criticalAtRiskCount = atRiskMembers.filter(
      (item) => item.exitRiskLabel === "Critical"
    ).length;
    const electionActive = activeElection?.status === "voting";
    const status = getStatusLabel({
      chairVacant: !caucus.chairId,
      criticalAtRiskCount,
      recentForcedExitCount,
      activeDefianceCount: defiance.activeCount,
      atRiskCount: atRiskMembers.length,
      recentLeaveCount,
      electionActive,
    });

    return {
      caucusId,
      caucusSlug: caucus.slug,
      caucusName: caucus.name,
      statusLabel: status.statusLabel,
      statusReason: status.statusReason,
      chairId: caucus.chairId?.toString() ?? null,
      chairName: caucus.chairId ? (chairNameById.get(caucus.chairId.toString()) ?? null) : null,
      chairVacant: !caucus.chairId,
      memberCounts,
      activeDefianceCount: defiance.activeCount,
      playerDefianceCount: defiance.playerCount,
      nppDefianceCount: defiance.nppCount,
      atRiskCount: atRiskMembers.length,
      criticalAtRiskCount,
      recentJoinCount,
      recentLeaveCount,
      recentForcedExitCount,
      election: {
        status: electionActive ? "active" : activeElection ? "recently_completed" : "idle",
        electionId: activeElection?._id.toString() ?? null,
        candidateCount: activeElection
          ? (candidateCountsByElectionId.get(activeElection._id.toString()) ?? 0)
          : 0,
        totalVotes: activeElection
          ? (voteCountsByElectionId.get(activeElection._id.toString()) ?? 0)
          : 0,
        endTurn: activeElection?.endTurn ?? null,
        endTime: activeElection?.endTime.toISOString() ?? null,
        winnerId: activeElection?.winnerId?.toString() ?? null,
        winnerName: activeElection?.winnerId
          ? (characterById.get(activeElection.winnerId.toString())?.name ?? null)
          : null,
      },
      atRiskMembers,
      recentChurn,
      href: buildCaucusHref(countryId, partyId, caucus.slug),
    } satisfies CaucusHealthItem;
  });

  return {
    recentWindowTurns: CAUCUS_RECENT_WINDOW_TURNS,
    healthyCount: caucusHealthItems.filter((item) => item.statusLabel === "Healthy").length,
    strainedCount: caucusHealthItems.filter((item) => item.statusLabel === "Strained").length,
    fragileCount: caucusHealthItems.filter((item) => item.statusLabel === "Fragile").length,
    activeElectionCount: caucusHealthItems.filter((item) => item.election.status === "active")
      .length,
    chairVacancyCount: caucusHealthItems.filter((item) => item.chairVacant).length,
    recentJoinCount: caucusHealthItems.reduce((sum, item) => sum + item.recentJoinCount, 0),
    recentLeaveCount: caucusHealthItems.reduce((sum, item) => sum + item.recentLeaveCount, 0),
    recentForcedExitCount: caucusHealthItems.reduce(
      (sum, item) => sum + item.recentForcedExitCount,
      0
    ),
    activeDefianceCount: caucusHealthItems.reduce((sum, item) => sum + item.activeDefianceCount, 0),
    atRiskMemberCount: caucusHealthItems.reduce((sum, item) => sum + item.atRiskCount, 0),
    caucuses: caucusHealthItems,
  };
}
