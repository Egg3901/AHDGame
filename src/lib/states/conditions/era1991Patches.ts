import type { Condition } from "@/lib/utils/approvalModifiers";

export interface Era1991ModifierPatch {
  /** Skip this modifier entirely in 1991-era worlds. */
  suppress?: boolean;
  /** Replace the modern threshold set when not suppressed. */
  conditions?: Condition[];
}

/**
 * Per-modifier overrides for metrics that are intentionally anachronistic in
 * 1991-default seeds (broadband=0, halved COL index, clamped media metrics).
 */
export const ERA1991_MODIFIER_PATCHES: Record<string, Era1991ModifierPatch> = {
  affordable_living: {
    conditions: [{ category: "economic", metric: "costOfLiving", op: "<=", value: 50 }],
  },
  affordable_housing: {
    conditions: [{ category: "social", metric: "housingAffordability", op: "<=", value: 35 }],
  },
  cost_of_living_crisis: {
    conditions: [
      { category: "economic", metric: "costOfLiving", op: ">=", value: 70 },
      { category: "economic", metric: "povertyRate", op: ">=", value: 17 },
    ],
  },
  housing_crisis: {
    conditions: [
      { category: "social", metric: "homelessnessRate", op: ">=", value: 24 },
      { category: "economic", metric: "costOfLiving", op: ">=", value: 65 },
    ],
  },
  slow_growth: {
    conditions: [{ category: "economic", metric: "gdpGrowth", op: "<=", value: 0 }],
  },
  universal_healthcare: {
    conditions: [
      { category: "healthcare", metric: "uninsuredRate", op: "<=", value: 10 },
      { category: "healthcare", metric: "physicianRate", op: ">=", value: 2.5 },
    ],
  },
  corruption_concerns: {
    conditions: [{ category: "governance", metric: "corruptionIndex", op: ">=", value: 52 }],
  },
  media_polarization: {
    conditions: [
      { category: "mediaInformation", metric: "mediaPolarization", op: ">=", value: 33 },
    ],
  },
  information_disorder: {
    conditions: [
      { category: "mediaInformation", metric: "mediaPolarization", op: ">=", value: 33 },
      { category: "mediaInformation", metric: "disinformationRisk", op: ">=", value: 18 },
    ],
  },
  press_suppression: {
    conditions: [
      { category: "mediaInformation", metric: "pressFreedom", op: "<=", value: 40 },
      { category: "mediaInformation", metric: "disinformationRisk", op: ">=", value: 15 },
    ],
  },
  low_broadband: { suppress: true },
  high_broadband: { suppress: true },
  infrastructure_boom: { suppress: true },
  infrastructure_crisis: {
    conditions: [
      { category: "infrastructure", metric: "roadCondition", op: "<=", value: 55 },
      { category: "infrastructure", metric: "waterQuality", op: "<=", value: 80 },
    ],
  },
  heavy_public_debt: { suppress: true },
  research_hub: {
    conditions: [{ category: "economic", metric: "rdIntensity", op: ">=", value: 2.9 }],
  },
};
