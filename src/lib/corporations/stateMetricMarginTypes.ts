import type { CorporationType } from "@/lib/constants/corporations";
import type { MetricCategoryId, StateMetrics } from "@/lib/db/types";

export type SectorMetricMarginChannel =
  | "laborCost"
  | "laborQuality"
  | "consumerDemand"
  | "physicalLogistics"
  | "digitalInfrastructure"
  | "gridReliability"
  | "publicSafety"
  | "regulatoryTrust"
  | "environmentalCompliance"
  | "healthCapacity"
  | "housingLandUse"
  | "innovation"
  | "mediaTrust"
  | "demographics"
  | "publicProcurement";

export interface StateMetricMarginContribution {
  category: MetricCategoryId;
  metricId: string;
  label: string;
  rawValue: number;
  modifier: number;
  channel: SectorMetricMarginChannel;
  rationale: string;
}

export interface StateMetricHeadlineModifiers {
  unemploymentModifier?: number;
  gridReliabilityModifier?: number;
  corruptionModifier?: number;
  workforceSkillModifier?: number | null;
  crimeRateModifier?: number | null;
  broadbandModifier?: number | null;
  roadConditionModifier?: number | null;
  carbonEmissionsModifier?: number | null;
  costOfLivingModifier?: number | null;
}

export interface StateMetricMarginResult {
  total: number;
  cappedTotal: number;
  legacyTotal: number;
  contributions: StateMetricMarginContribution[];
  headlineModifiers: StateMetricHeadlineModifiers;
}

export interface StateMetricMarginOverride {
  total: number;
  legacyTotal?: number;
  contributions?: StateMetricMarginContribution[];
  headlineModifiers?: StateMetricHeadlineModifiers;
}

export interface StateMetricMarginInput {
  sectorType: CorporationType;
  strategyId?: string | null;
  transitionFromStrategyId?: string | null;
  transitionProgress?: number | null;
  stateMetrics?: StateMetrics | null;
  countryId?: string | null;
  /** Live era year (null while eraSystemEnabled is off) — inactive metrics contribute 0. */
  year?: number | null;
  /**
   * SP4 §4a: political signals for LAW_COUNTRY_IDS regions, resolved from the
   * region's politicalMetrics board (marginAdapter.buildPoliticalBaseModifiers).
   * Consulted when the stateMetrics doc lacks a signal's value (post-demolition);
   * absent for non-playable regions — their code path is byte-identical.
   */
  politicalBaseModifiers?: ReadonlyMap<string, { modifier: number; rawValue: number }> | null;
}
