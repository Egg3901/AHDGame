/** Metrics v2 condition replacements use the catalog's actual units. */
import type { Condition } from "@/lib/utils/approvalModifiers";

// Preserve effect sizes. Replaced inputs are explicit, never aliases between
// unlike units (housing burden and research capability are 1991-base indexes).
const replacements: Readonly<Record<string, Condition[]>> = {
  universal_healthcare: [
    { category: "healthcare", metric: "coverageRate", op: ">=", value: 95 },
    { category: "healthcare", metric: "affordabilityIndex", op: ">=", value: 78 },
  ],
  weak_healthcare_capacity: [
    { category: "healthcare", metric: "coverageRate", op: "<=", value: 85 },
    { category: "healthcare", metric: "affordabilityIndex", op: "<=", value: 55 },
  ],
  education_excellence: [
    { category: "education", metric: "highSchoolGradRate", op: ">=", value: 92 },
    {
      category: "education",
      metric: "learningAttainment",
      op: ">=",
      value: 115,
      thresholdYear: "absolute",
    },
  ],
  safe_streets: [{ category: "publicSafety", metric: "violentCrimeRate", op: "<=", value: 320 }],
  crime_wave: [{ category: "publicSafety", metric: "violentCrimeRate", op: ">=", value: 420 }],
  affordable_housing: [
    {
      category: "social",
      metric: "housingCostBurden",
      op: "<=",
      value: 80,
      thresholdYear: "absolute",
    },
  ],
  housing_stress: [
    {
      category: "social",
      metric: "housingCostBurden",
      op: ">=",
      value: 120,
      thresholdYear: "absolute",
    },
  ],
  housing_crisis: [
    { category: "social", metric: "homelessnessRate", op: ">=", value: 28 },
    {
      category: "social",
      metric: "housingCostBurden",
      op: ">=",
      value: 130,
      thresholdYear: "absolute",
    },
  ],
  research_hub: [
    {
      category: "education",
      metric: "researchCapability",
      op: ">=",
      value: 120,
      thresholdYear: "absolute",
    },
  ],
  information_disorder: [
    { category: "mediaInformation", metric: "disinformationRisk", op: ">=", value: 55 },
  ],
};

export function resetApprovalConditions(id: string, legacy: Condition[]): Condition[] {
  return replacements[id] ?? legacy;
}

export function hasResetApprovalConditions(id: string): boolean {
  return Object.hasOwn(replacements, id);
}
