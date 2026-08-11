import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { getOrganizationLegislationCollection } from "@/lib/db/collections";

/**
 * Joint statements are member-voted declarations an (political / security)
 * organization issues about a subject country: an **endorsement** or a
 * **condemnation**. Passage applies a bounded, time-limited government-approval
 * effect to the subject, folded into the per-turn approval snapshot recompute
 * (the same mechanism the governor State-of-the-State address bump uses), so it
 * persists across turns and lifts cleanly when the statement lapses.
 */

export type JointStatementStance = "endorse" | "condemn";

/**
 * Approval points a joint statement moves the subject country, bounded to the
 * named-modifier scale (±1..3). Condemnation by the international community
 * stings harder than an endorsement helps.
 */
export const JOINT_STATEMENT_ENDORSE_APPROVAL = 2;
export const JOINT_STATEMENT_CONDEMN_APPROVAL = -3;

/** Turns the approval effect lasts before the statement lapses (~½ in-game year). */
export const JOINT_STATEMENT_DURATION_TURNS = 24;

/** Signed approval delta for a stance. Pure. */
export function jointStatementApprovalEffect(stance: JointStatementStance): number {
  return stance === "endorse" ? JOINT_STATEMENT_ENDORSE_APPROVAL : JOINT_STATEMENT_CONDEMN_APPROVAL;
}

/**
 * Active joint statements about `countryId` as approval modifiers for the
 * government-approval snapshot to apply. Filters to un-expired statements so an
 * effect that has lapsed contributes nothing even before the turn sweep flips
 * its status to terminated.
 */
export async function getActiveOrgStatementModifiersByCountry(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<ActiveModifier[]> {
  const col = await getOrganizationLegislationCollection(db);
  const active = await col
    .find({
      type: "joint_statement",
      status: "active",
      jointStatementSubjectCountryId: countryId,
      jointStatementExpiresOnTurn: { $gt: currentTurn },
    })
    .toArray();
  return active.map((s) => ({
    id: `org_statement:${s._id.toString()}`,
    label: `${s.organizationId} ${s.jointStatementStance === "endorse" ? "endorsement" : "condemnation"}`,
    effect: jointStatementApprovalEffect(
      (s.jointStatementStance ?? "endorse") as JointStatementStance
    ),
  }));
}
