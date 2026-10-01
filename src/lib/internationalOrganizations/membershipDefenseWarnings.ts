import type { Db } from "mongodb";
import { getCountryDisplayName, type CountryId } from "@/lib/constants/countries";
import {
  BLOC_DESIGNATED_ORG_IDS,
  canTableResolutionType,
  type OrganizationCategory,
} from "@/lib/constants/orgCategory";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { Bill, BillStatus, DeclareWarProvision } from "@/lib/db/types/legislation";

export interface MembershipDefenseWarning {
  organizationId: string;
  applicantCountryId: CountryId;
  kind: "active_conflict" | "pending_declaration";
  opposingNames: string[];
  /** Present only once the declaration has produced a conflict the organization can enter. */
  conflictId?: string;
  conflictName?: string;
  side?: "A" | "B";
  declarationBillId?: string;
}

interface WarnableOrganization {
  id: string;
  def: { category: OrganizationCategory };
  pendingMembershipProposals: Array<{ proposingCountryId: CountryId }>;
}

const PENDING_DECLARATION_STATUSES: BillStatus[] = [
  "proposed",
  "active",
  "passed_origin",
  "active_other",
  "active_both",
  "enrolled",
  "vetoed",
  "veto_override",
  "cabinet_review",
  "override_shugiin",
];

function applicantSide(conflict: ConflictDoc, applicant: CountryId): "A" | "B" | null {
  if (conflict.sideA.countries.includes(applicant)) return "A";
  if (conflict.sideB.countries.includes(applicant)) return "B";
  return null;
}

/**
 * Warn an armed bloc what an accession may mean for wars already in motion.
 *
 * Fresh attacks after admission still invoke the treaty immediately in `declareWar`.
 * This read model covers the seam that declaration-time enforcement cannot: a war
 * already underway before the applicant became a member, plus declarations still
 * before an aggressor's legislature.
 */
export async function loadMembershipDefenseWarnings(
  db: Db,
  organizations: WarnableOrganization[],
  preset?: string
): Promise<Map<string, MembershipDefenseWarning[]>> {
  const warnable = organizations.filter(
    (organization) =>
      BLOC_DESIGNATED_ORG_IDS.includes(organization.id) &&
      canTableResolutionType(organization.def.category, "join_conflict")
  );
  const applicants = [
    ...new Set(
      warnable.flatMap((organization) =>
        organization.pendingMembershipProposals.map((proposal) => proposal.proposingCountryId)
      )
    ),
  ];
  if (applicants.length === 0) return new Map();

  const [conflicts, declarations] = await Promise.all([
    getConflictsCollection(db)
      .find({
        status: { $in: ["active", "escalating", "winding_down"] },
        $or: [{ hostCountry: { $in: applicants } }, { hostEntities: { $in: applicants } }],
      })
      .toArray(),
    db
      .collection<Bill>("bills")
      .find({
        status: { $in: PENDING_DECLARATION_STATUSES },
        provisions: {
          $elemMatch: { type: "declare_war", targetCountry: { $in: applicants } },
        },
      } as never)
      .project<Pick<Bill, "_id" | "countryId" | "provisions">>({
        countryId: 1,
        provisions: 1,
      })
      .toArray(),
  ]);

  const byOrganization = new Map<string, MembershipDefenseWarning[]>();
  for (const organization of warnable) {
    const warnings: MembershipDefenseWarning[] = [];
    const seen = new Set<string>();
    for (const proposal of organization.pendingMembershipProposals) {
      const applicant = proposal.proposingCountryId;
      for (const conflict of conflicts) {
        const hosts = conflict.hostEntities ?? [conflict.hostCountry];
        if (!hosts.includes(applicant)) continue;
        const side = applicantSide(conflict, applicant);
        if (!side) continue;
        const opposing = side === "A" ? conflict.sideB.countries : conflict.sideA.countries;
        const key = `${applicant}:conflict:${conflict._id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        warnings.push({
          organizationId: organization.id,
          applicantCountryId: applicant,
          kind: "active_conflict",
          conflictId: conflict._id,
          conflictName: conflict.name,
          side,
          opposingNames: opposing.map((countryId) => getCountryDisplayName(countryId, preset)),
        });
      }

      for (const bill of declarations) {
        const declarer = bill.countryId;
        if (!declarer) continue;
        const targetsApplicant = bill.provisions?.some(
          (provision): provision is DeclareWarProvision =>
            provision.type === "declare_war" && provision.targetCountry === applicant
        );
        if (!targetsApplicant) continue;
        const key = `${applicant}:declaration:${bill._id.toString()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        warnings.push({
          organizationId: organization.id,
          applicantCountryId: applicant,
          kind: "pending_declaration",
          declarationBillId: bill._id.toString(),
          opposingNames: [getCountryDisplayName(declarer, preset)],
        });
      }
    }
    if (warnings.length > 0) byOrganization.set(organization.id, warnings);
  }

  return byOrganization;
}
