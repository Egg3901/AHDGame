import type { NationalizationProvisionDetail } from "@/lib/congress/billEnrichment";
import type { BillDetail } from "@/lib/legislature/dto/billDetail";
import type { BillProvisionDisplay } from "@/lib/legislature/dto/stateLegislature";
import { splitPolicyLabel } from "@/lib/legislature/policyLabel";

type NationalProvision = NonNullable<BillDetail["provisions"]>[number];

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

/** National DTO → view. Labels are combined "Title: description"; split them.
 * Current is ALWAYS present ("Current law" fallback) so national renders
 * pixel-identically to before — the national DTO has no `type` to detect subsidies. */
export function nationalProvisionToView(p: NationalProvision): BillProvisionView {
  const proposed = splitPolicyLabel(p.policyOptionName);
  const current = splitPolicyLabel(p.currentPolicyOptionName);
  return {
    legislationTypeName: p.legislationTypeName,
    current: { title: current.title ?? "Current law", description: current.description },
    proposed: { title: proposed.title ?? "Unknown", description: proposed.description },
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

/** State DTO → view. Name/description are separate fields. Subsidy/end-subsidy
 * provisions have no current law → current = null (proposed-only box). */
export function stateProvisionToView(p: BillProvisionDisplay): BillProvisionView {
  const isSubsidy = p.type === "subsidy" || p.type === "end_subsidy";
  return {
    legislationTypeName: p.legislationTypeName ?? "Provision",
    current: isSubsidy
      ? null
      : {
          title: p.currentPolicyOptionName ?? "Current law",
          description: p.currentPolicyOptionDescription ?? undefined,
        },
    proposed: {
      title: p.policyOptionName ?? "Unknown",
      description: p.policyOptionDescription ?? undefined,
    },
    effectDirection: p.effectDirection,
    economic: p.economic ?? undefined,
    social: p.social ?? undefined,
    effects: p.effects,
    archetypeApprovals: p.archetypeApprovals,
    policyDomain: p.policyDomain ?? undefined,
    currentPolicyIndex: p.currentPolicyIndex,
    proposedPolicyIndex: p.proposedPolicyIndex,
    policyOptionScores: p.policyOptionScores,
  };
}
