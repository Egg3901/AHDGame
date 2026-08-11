/**
 * Public-service mandate map (spec §11.1). Pure: maps an SOE sector type to the
 * state metric(s) it improves, scaled by the SOE's share of the state sector and
 * its posture. No DB. Metric paths are `${category}.${field}` into StateMetrics
 * and were verified against src/lib/db/types/stateMetrics.ts.
 */
import type { Corporation, CorporateSector, SoeMandate } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import {
  SOE_MANDATE_CONTRIBUTION_AT_FULL_SHARE,
  SOE_PRICE_CONTROL_BONUS_MULTIPLIER,
  SOE_MANDATE_PER_METRIC_CAP,
} from "./constants";

/**
 * One metric this sector type contributes to. `direction` is +1 to raise the
 * metric (good for "higher is better" metrics) and -1 to lower it (for metrics
 * where lower is better, e.g. inequality / unemployment). `weight` scales the
 * base contribution (secondary effects are smaller).
 */
export interface MandateContributionDef {
  metricPath: string;
  direction: 1 | -1;
  weight: number;
}

/** A computed, signed delta to apply this turn. */
export interface MandateContribution {
  metricPath: string;
  /** Signed pp delta (already capped); add to the metric's current value. */
  delta: number;
}

export const MANDATE_MAP: Partial<Record<CorporationType, MandateContributionDef[]>> = {
  healthcare: [{ metricPath: "healthcare.physicianRate", direction: 1, weight: 1 }],
  energy: [{ metricPath: "infrastructure.powerGridReliability", direction: 1, weight: 1 }],
  logistics: [{ metricPath: "infrastructure.roadCondition", direction: 1, weight: 1 }],
  automobiles: [{ metricPath: "infrastructure.roadCondition", direction: 1, weight: 1 }],
  construction: [{ metricPath: "infrastructure.roadCondition", direction: 1, weight: 1 }],
  telecommunications: [{ metricPath: "infrastructure.broadbandAccess", direction: 1, weight: 1 }],
  technology: [{ metricPath: "infrastructure.broadbandAccess", direction: 1, weight: 1 }],
  agriculture: [{ metricPath: "economic.foodSecurity", direction: 1, weight: 1 }],
  defense: [{ metricPath: "governance.publicTrust", direction: 1, weight: 1 }],
  financial: [
    { metricPath: "economic.smallBusinessFormation", direction: 1, weight: 1 },
    { metricPath: "social.incomeInequality", direction: -1, weight: 0.5 },
  ],
  // State industry sustains the manufacturing base.
  manufacturing: [{ metricPath: "economic.manufacturingCompetitiveness", direction: 1, weight: 1 }],
  chemical_industries: [
    { metricPath: "economic.manufacturingCompetitiveness", direction: 1, weight: 1 },
  ],
  // State retail holds consumer prices down (cost of living: lower is better).
  retail: [{ metricPath: "economic.costOfLiving", direction: -1, weight: 1 }],
  // Public housing improves affordability (ratio: lower is better).
  real_estate: [{ metricPath: "social.housingAffordability", direction: -1, weight: 1 }],
};

/**
 * Per-country mandate overrides (spec §11.1). A country may remap a sector type
 * to a country-specific metric. Example: DE defense targets bundeswehrReadiness
 * instead of the generic publicTrust. Empty by default; the generic map applies.
 */
const COUNTRY_OVERRIDES: Partial<
  Record<CountryId, Partial<Record<CorporationType, MandateContributionDef[]>>>
> = {
  DE: {
    defense: [{ metricPath: "governance.bundeswehrReadiness", direction: 1, weight: 1 }],
  },
};

/** Resolve a sector's effective posture: sector override beats corp default. */
export function resolveSectorMandate(
  corp: Pick<Corporation, "soeMandate">,
  sector: Pick<CorporateSector, "soeMandate">
): SoeMandate {
  return {
    priceControlled: sector.soeMandate?.priceControlled ?? corp.soeMandate?.priceControlled,
    employmentGuaranteed:
      sector.soeMandate?.employmentGuaranteed ?? corp.soeMandate?.employmentGuaranteed,
  };
}

function defsFor(countryId: CountryId, sectorType: CorporationType): MandateContributionDef[] {
  return COUNTRY_OVERRIDES[countryId]?.[sectorType] ?? MANDATE_MAP[sectorType] ?? [];
}

/**
 * The state-metric paths a sector type's mandate uplifts in a country (honouring
 * per-country overrides). Read-only accessor over the mandate map for display
 * (e.g. the National Corporation Overview's public-mandate scorecard).
 */
export function getMandateMetricPaths(countryId: CountryId, sectorType: CorporationType): string[] {
  return defsFor(countryId, sectorType).map((d) => d.metricPath);
}

/**
 * Compute the signed per-turn contributions for one SOE sector. `soeShare` is
 * the SOE's revenue/market share of its (state, sectorType) in [0,1]. Price
 * control strengthens the public-value contribution; employment guarantee adds
 * an unemployment-relief contribution. Each delta is capped per metric.
 */
export function getMandateContributions(
  countryId: CountryId,
  sector: Pick<CorporateSector, "sectorType">,
  mandate: SoeMandate,
  soeShare: number
): MandateContribution[] {
  const share = Math.max(0, Math.min(1, Number.isFinite(soeShare) ? soeShare : 0));
  if (share <= 0) return [];

  const controlMult = mandate.priceControlled ? SOE_PRICE_CONTROL_BONUS_MULTIPLIER : 1;
  const base = SOE_MANDATE_CONTRIBUTION_AT_FULL_SHARE * share * controlMult;

  const out: MandateContribution[] = [];
  for (const def of defsFor(countryId, sector.sectorType)) {
    const magnitude = Math.min(SOE_MANDATE_PER_METRIC_CAP, base * def.weight);
    out.push({ metricPath: def.metricPath, delta: magnitude * def.direction });
  }

  if (mandate.employmentGuaranteed) {
    const magnitude = Math.min(SOE_MANDATE_PER_METRIC_CAP, base);
    out.push({ metricPath: "economic.unemploymentRate", delta: -magnitude });
  }
  return out;
}
