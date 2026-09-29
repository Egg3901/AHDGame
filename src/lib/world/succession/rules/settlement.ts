/**
 * A negotiated federation settlement binds consent, territory and finances to
 * one proposal. planFederationSettlement derives financial population weights
 * from the transferred regions and never publishes an unapproved allocation.
 */
import { evaluateSuccessionApproval, type SuccessionApprovalInput } from "./decision";
import { planSuccessionFinances, type SuccessionFinancialTerms } from "./financialSettlement";
import { planSuccessionTerritories, type SuccessionRegion } from "./territory";

export interface FederationSettlementInput {
  approval: SuccessionApprovalInput;
  regions: readonly SuccessionRegion[];
  assignments: Readonly<Record<string, string>>;
  finances: Omit<SuccessionFinancialTerms, "settlementId" | "participants">;
}

/** Callers persist the resulting immutable plan only after the approval gate is ready. */
export function planFederationSettlement(input: FederationSettlementInput) {
  const approval = evaluateSuccessionApproval(input.approval);
  if (approval.status !== "ready") return { approval, plan: null };
  const territories = planSuccessionTerritories(
    input.regions,
    input.approval.requiredParticipants,
    input.assignments
  );
  const finances = planSuccessionFinances({
    ...input.finances,
    settlementId: input.approval.settlementId,
    participants: territories.map(({ entityId, population }) => ({ entityId, population })),
  });
  return {
    approval,
    plan: {
      settlementId: input.approval.settlementId,
      revision: input.approval.revision,
      territories,
      finances,
    },
  };
}
