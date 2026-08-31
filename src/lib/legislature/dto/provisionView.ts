import type { NationalizationProvisionDetail } from "@/lib/nationalization/billTargetPreview";
import type { ProvisionDisplay } from "@/lib/legislature/provisionEnrichment";

export interface BillProvisionView {
  legislationTypeName: string;
  current: { title: string; description?: string } | null;
  proposed: { title: string; description?: string };
  effectDirection: number;
  economic?: number;
  social?: number;
  effects?: { metric: string; direction: "up" | "down"; isGood: boolean }[];
  archetypeApprovals?: Record<string, number>;
  policyDomain?: string;
  currentPolicyIndex?: number;
  proposedPolicyIndex?: number;
  policyOptionScores?: number[];
  nationalizationDetail?: NationalizationProvisionDetail;
  /** Political-legislation v2 (spec §8): live fiscal profile + net delta. */
  fiscal?: {
    currencyCode: string;
    proposed?: { cost: number; revenue: number; net: number };
    current?: { cost: number; revenue: number; net: number };
    netDelta?: number;
    currentRate?: number;
    proposedRate?: number;
    revenueDelta?: number;
  };
}

/**
 * Resolved provision -> card view.
 *
 * One mapper for both bill pages: the national and regional adapters now emit
 * the same {@link ProvisionDisplay}. This is the rename from the DTO's
 * name/explanation to the card's title/description, and the only place the two
 * vocabularies meet.
 *
 * Subsidy and end-subsidy provisions have no current law, so they render as a
 * proposed-only box.
 */
export function provisionToView(p: ProvisionDisplay): BillProvisionView {
  const isSubsidy = p.type === "subsidy" || p.type === "end_subsidy";
  return {
    legislationTypeName: p.legislationTypeName,
    current: isSubsidy
      ? null
      : { title: p.current?.name ?? "Current law", description: p.current?.explanation },
    proposed: { title: p.proposed.name, description: p.proposed.explanation },
    effectDirection: p.effectDirection,
    economic: p.economic,
    social: p.social,
    effects: p.effects,
    archetypeApprovals: p.archetypeApprovals,
    policyDomain: p.policyDomain,
    currentPolicyIndex: p.currentPolicyIndex,
    proposedPolicyIndex: p.proposedPolicyIndex,
    policyOptionScores: p.policyOptionScores,
    nationalizationDetail: p.nationalizationDetail,
    fiscal: p.fiscal,
  };
}
