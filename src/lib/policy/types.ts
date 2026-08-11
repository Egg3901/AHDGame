// Response types for /api/country/[code]/policy. Shared with UI consumers via
// lib so they don't reach into the route file.

import type { Tariff, Subsidy } from "@/lib/db/types";

export interface PolicyMetricEffect {
  category: string;
  metricId: string;
  ratePerTurn: number;
}

export interface WeightedPolicyEffect {
  metricCategoryId: string;
  metricId: string;
  isPositive: boolean;
}

export interface PolicyRecordResponse {
  recordType?: "policy" | "tariff" | "subsidy";
  legislationTypeId: string;
  name: string;
  policyDomain: string;
  economic: number;
  social: number;
  nationalOnly: boolean;
  /** Name of the policy option that best matches this position (from legislation type options) */
  policyOptionName: string | null;
  hasEconomic: boolean;
  hasSocial: boolean;
  /** Direct per-turn metric effects from the matched policy option */
  metricEffects: PolicyMetricEffect[];
  /** Secondary metric targets from effectTargetsWeighted (indirect policy-decay effects) */
  weightedEffects?: WeightedPolicyEffect[];
  /** Human-readable summary for non-policy records like tariffs */
  detailText?: string | null;
  tariffRate?: number | null;
  tariffScopeType?: Tariff["scopeType"] | null;
  subsidyScope?: Subsidy["scope"] | null;
  subsidyScopeType?: Subsidy["scopeType"] | null;
  subsidyDomesticOnly?: boolean | null;
  subsidyTargetSectorType?: Subsidy["targetSectorType"] | null;
  subsidyTargetStrategyId?: string | null;
  /** Where this active policy came from — bill enactment, an executive order,
   *  or an expired/rescinded order revert. Only populated for policy records. */
  enactedByKind?: "bill" | "order" | "expiry" | null;
  /** Set when enactedByKind === "order" — info needed to label the active order. */
  activeOrder?: {
    orderId: string;
    issuedByName: string;
    issuedAtTurn: number;
    expiresAtTurn: number;
  } | null;
}
