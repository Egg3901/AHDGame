import type { CountryId } from "@/lib/constants/countries";
import type { NationalizationProvisionDetail } from "@/lib/nationalization/billTargetPreview";
import type { ProvisionEffectChip } from "@/lib/legislature/provisionEffects";

/**
 * Which way a provision pushes, as a label.
 *
 * The single copy: this existed three times over (congress/billEnrichment,
 * legislature/mapStateBillToBillDisplay, legislature/queries/stateBillQueries).
 */
export function directionLabel(d: number): "Left" | "Center" | "Right" {
  if (d < 0) return "Left";
  if (d > 0) return "Right";
  return "Center";
}

/**
 * A policy option's display text, kept structured.
 *
 * Never pre-combined into "Name: explanation". The old combiner dropped
 * `option.name` whenever the explanation already contained ": ", which made the
 * rendered title a fragment of the explanation for 33 of the 2502 seeded
 * options. Keeping the two fields apart removes the failure mode.
 */
export interface ProvisionLabel {
  name: string;
  explanation?: string;
}

export interface ProvisionFiscal {
  currencyCode: string;
  proposed?: { cost: number; revenue: number; net: number };
  current?: { cost: number; revenue: number; net: number };
  netDelta?: number;
  currentRate?: number;
  proposedRate?: number;
  revenueDelta?: number;
}

/**
 * Which budget and fiscal base a provision resolves against.
 *
 * `countryId` is the broad `CountryId`, not `LawCountryId`: regional
 * legislatures exist for countries outside the political-legislation roster, and
 * the current-law lookup applies to all of them. Fiscal resolution narrows to
 * the four law countries itself, via `COST_INCOME_ANCHORS`.
 */
export type FiscalScope =
  | { scope: "national"; countryId: CountryId }
  | { scope: "region"; countryId: CountryId; regionId: string };

/**
 * One bill provision, resolved for display.
 *
 * Emitted identically by the national adapter (`congress/billEnrichment`) and
 * the regional adapter (`legislature/queries/stateBillQueries`) so both feed the
 * same `BillProvisionCard`.
 */
export interface ProvisionDisplay {
  legislationTypeId?: string;
  legislationTypeName: string;
  policyOptionId?: string;

  proposed: ProvisionLabel;
  /** Absent for subsidy / end_subsidy provisions, which have no current law. */
  current?: ProvisionLabel;
  proposedPolicyIndex?: number;
  currentPolicyIndex?: number;

  effectDirection: number;
  directionLabel: "Left" | "Center" | "Right";
  positionLabel?: string;
  effectTargetLabel?: string;
  effectTargetsWeighted?: { metricCategoryId: string; metricId: string; weight: number }[];
  effects?: ProvisionEffectChip[];

  archetypeApprovals?: Record<string, number>;
  /** @deprecated Superseded by archetypeApprovals; retained for existing state consumers. */
  groupApprovals?: Record<string, number>;
  policyDomain?: string;
  policyOptionScores?: number[];
  economic?: number;
  social?: number;

  fiscal?: ProvisionFiscal;
  annualCostPerCapita?: number | null;
  gdpPerCapitaMultiplier?: number | null;

  // Adapter-owned extras.
  type?: "subsidy" | "end_subsidy";
  scopeType?: "economy_wide" | "sector";
  targetSectorType?: string | null;
  nationalizationDetail?: NationalizationProvisionDetail;
}
