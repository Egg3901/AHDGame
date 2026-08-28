import type { Db } from "mongodb";
import { getCountryDisplayName, type CountryId } from "@/lib/constants/countries";
import type { Bill, BillStatus } from "@/lib/db/types/legislation";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { OrganizationLegislation } from "@/lib/db/types/internationalOrganization";
import type { OrganizationSummary } from "@/lib/internationalOrganizations/service";
import { classifyWarEntry, hostSideOf, type WarEntryStake } from "@/lib/military/warEntryPolicy";

export interface MemberWarEntryStatus {
  countryId: string;
  stake: WarEntryStake;
  status: "joined" | "pending" | "approved" | "failed" | "opposing" | "awaiting";
  billId?: string;
  billStatus?: BillStatus;
  lower?: { for: number; against: number; abstain: number };
  upper?: { for: number; against: number; abstain: number };
}

export interface BlocWarEntryOperation {
  conflictId: string;
  conflictName: string;
  conflictStatus: ConflictDoc["status"];
  militaryOrganizationId: string;
  resolutionId: string;
  side: "A" | "B";
  stake: Exclude<WarEntryStake, "principal_belligerent">;
  opposingNames: string[];
  members: MemberWarEntryStatus[];
}

const DISPLAY_TO_MILITARY_ORG: Readonly<Record<string, string>> = {
  NATO: "NATO",
  COMECON: "WARSAW_PACT",
};

function billOutcome(status: BillStatus): MemberWarEntryStatus["status"] {
  if (status === "signed") return "approved";
  if (status === "failed" || status === "override_failed" || status === "withdrawn") {
    return "failed";
  }
  return "pending";
}

/**
 * Project the military-entry record onto the two bloc pages players actually
 * use. COMECON displays its linked Warsaw Pact operation but never becomes the
 * legal source of the military call.
 */
export async function loadBlocWarEntryStatusByDisplayOrg(
  db: Db,
  organizations: OrganizationSummary[],
  preset?: string
): Promise<Map<string, BlocWarEntryOperation[]>> {
  const displayOrgs = organizations.filter((org) => DISPLAY_TO_MILITARY_ORG[org.id]);
  if (displayOrgs.length === 0) return new Map();
  const militaryOrgIds = [...new Set(displayOrgs.map((org) => DISPLAY_TO_MILITARY_ORG[org.id]))];
  const resolutions = await db
    .collection<OrganizationLegislation>("organizationLegislation")
    .find({
      organizationId: { $in: militaryOrgIds },
      type: "join_conflict",
      status: "active",
    })
    .toArray();
  if (resolutions.length === 0) return new Map();

  const resolutionIds = resolutions.map((resolution) => resolution._id.toString());
  const theaterIds = resolutions
    .map((resolution) => resolution.joinConflictTheaterId)
    .filter((id): id is string => Boolean(id));
  const [conflicts, bills] = await Promise.all([
    db
      .collection<ConflictDoc>("conflicts")
      .find({ _id: { $in: theaterIds } })
      .toArray(),
    db
      .collection<Bill>("bills")
      .find({ "provisions.resolutionId": { $in: resolutionIds } })
      .toArray(),
  ]);
  const conflictById = new Map(conflicts.map((conflict) => [conflict._id, conflict] as const));
  const result = new Map<string, BlocWarEntryOperation[]>();

  for (const displayOrg of displayOrgs) {
    const militaryOrganizationId = DISPLAY_TO_MILITARY_ORG[displayOrg.id];
    const operations: BlocWarEntryOperation[] = [];
    for (const resolution of resolutions.filter(
      (row) => row.organizationId === militaryOrganizationId
    )) {
      const conflictId = resolution.joinConflictTheaterId;
      const side = resolution.joinConflictSide;
      if (!conflictId || !side) continue;
      const conflict = conflictById.get(conflictId);
      if (!conflict) continue;
      const chosen = side === "A" ? conflict.sideA.countries : conflict.sideB.countries;
      const opposing = side === "A" ? conflict.sideB.countries : conflict.sideA.countries;
      const operationStake =
        hostSideOf(conflict) === side
          ? "collective_defense"
          : hostSideOf(conflict) == null
            ? "discretionary"
            : "offensive_coalition";
      const members = displayOrg.members.map((member): MemberWarEntryStatus => {
        const countryId = member.countryId;
        const stake = classifyWarEntry({
          conflict,
          countryId: countryId as CountryId,
          side,
          organizationId: militaryOrganizationId,
        });
        const bill = bills.find(
          (candidate) =>
            candidate.countryId === countryId &&
            candidate.provisions?.some(
              (provision) =>
                provision.type === "join_conflict" &&
                provision.resolutionId === resolution._id.toString()
            )
        );
        const base = {
          countryId,
          stake,
          ...(bill
            ? {
                billId: bill._id.toString(),
                billStatus: bill.status,
                lower: {
                  for: bill.votesFor,
                  against: bill.votesAgainst,
                  abstain: bill.votesAbstain,
                },
                ...((bill.otherChamberVotesFor ?? 0) +
                  (bill.otherChamberVotesAgainst ?? 0) +
                  (bill.otherChamberVotesAbstain ?? 0) >
                0
                  ? {
                      upper: {
                        for: bill.otherChamberVotesFor ?? 0,
                        against: bill.otherChamberVotesAgainst ?? 0,
                        abstain: bill.otherChamberVotesAbstain ?? 0,
                      },
                    }
                  : {}),
              }
            : {}),
        };
        if (chosen.includes(countryId as CountryId)) return { ...base, status: "joined" };
        if (opposing.includes(countryId as CountryId)) return { ...base, status: "opposing" };
        if (bill) return { ...base, status: billOutcome(bill.status) };
        return { ...base, status: "awaiting" };
      });
      operations.push({
        conflictId,
        conflictName: conflict.name,
        conflictStatus: conflict.status,
        militaryOrganizationId,
        resolutionId: resolution._id.toString(),
        side,
        stake: operationStake,
        opposingNames: opposing.map((countryId) => getCountryDisplayName(countryId, preset)),
        members,
      });
    }
    result.set(displayOrg.id, operations);
  }
  return result;
}
