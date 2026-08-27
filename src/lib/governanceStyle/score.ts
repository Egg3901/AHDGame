import type { GovernmentType } from "@/lib/constants/countries";
import { FAMILIES_BY_CATEGORY } from "@/lib/politicalMetrics/families";
import type { PoliticalMetricCategoryId, PoliticalMetricId } from "@/lib/politicalMetrics/types";
import type { DemocraticCompetition } from "./competition";

export interface GovernanceStyleAxis {
  /** Position on the displayed balance, from the named low pole to high pole. */
  value: number;
  label: string;
}

export interface GovernanceStyleScore {
  name: "Governance Style";
  variant: "liberal-democracy";
  /** 0 = Left, 100 = Right. Political direction, never a quality score. */
  leftRight: GovernanceStyleAxis;
  /** 0 = Failed State, 100 = Healthy Democracy. */
  democraticHealth: GovernanceStyleAxis;
  /** Competitive-control pressure applied only to democratic health. */
  competition: DemocraticCompetition | null;
}

type MetricValues = Partial<Record<PoliticalMetricId, number>>;

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const rounded = (value: number) => Math.round(clamp(value) * 10) / 10;
const finite = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Categories used for political direction. Governance and public order stay
 * out of this list because they supply the independent institutional-health
 * axis. Society's civicLife pair is also excluded below for the same reason.
 */
const IDEOLOGY_CATEGORIES: readonly PoliticalMetricCategoryId[] = [
  "economy",
  "education",
  "health",
  "infrastructure",
  "environment",
  "society",
  "defense",
];

const DEMOCRATIC_HEALTH_WEIGHTS = {
  "governance.participation": 0.17,
  "governance.openness": 0.17,
  "governance.integrity": 0.17,
  "governance.administration": 0.17,
  "order.dueProcess": 0.12,
  "order.courts": 0.1,
  "order.communityTrust": 0.05,
  "order.safety": 0.025,
  "society.civicLife": 0.025,
} as const satisfies Partial<Record<PoliticalMetricId, number>>;

/** Canonical political-metric basket used by the Democratic Health score. */
export const DEMOCRATIC_HEALTH_METRIC_IDS = Object.freeze(
  Object.keys(DEMOCRATIC_HEALTH_WEIGHTS) as PoliticalMetricId[]
);

const DEMOCRATIC_HEALTH_IDS = new Set<PoliticalMetricId>(DEMOCRATIC_HEALTH_METRIC_IDS);

function leftRightScore(values: MetricValues): number {
  let weightedContrast = 0;
  let totalWeight = 0;

  for (const categoryId of IDEOLOGY_CATEGORIES) {
    const families = FAMILIES_BY_CATEGORY[categoryId];
    for (let leftIndex = 0; leftIndex < 3; leftIndex++) {
      const left = families[leftIndex];
      const right = families[families.length - 1 - leftIndex];
      if (DEMOCRATIC_HEALTH_IDS.has(left.id) || DEMOCRATIC_HEALTH_IDS.has(right.id)) continue;

      const leftValue = values[left.id];
      const rightValue = values[right.id];
      if (!finite(leftValue) || !finite(rightValue)) continue;

      const weight = Math.abs(left.lean);
      weightedContrast += (rightValue - leftValue) * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) return 50;
  // A 10-point average advantage moves the balance 10 points. The full
  // 0-to-100 board spread therefore reaches a pole before the raw contrast
  // becomes absurdly lopsided, while ordinary coalition systems stay near the
  // centre.
  return rounded(50 + weightedContrast / totalWeight);
}

function democraticHealthScore(values: MetricValues): number {
  let weightedScore = 0;
  let totalWeight = 0;

  for (const [id, weight] of Object.entries(DEMOCRATIC_HEALTH_WEIGHTS)) {
    const value = values[id as PoliticalMetricId];
    if (!finite(value)) continue;
    weightedScore += clamp(value) * weight;
    totalWeight += weight;
  }

  return totalWeight === 0 ? 50 : rounded(weightedScore / totalWeight);
}

export function leftRightLabel(value: number): string {
  if (value < 20) return "Left";
  if (value < 47) return "Centre-left";
  if (value <= 53) return "Centre";
  if (value <= 80) return "Centre-right";
  return "Right";
}

export function democraticHealthLabel(value: number): string {
  if (value < 20) return "Failed state";
  if (value < 40) return "Failing democracy";
  if (value < 60) return "Fragile democracy";
  if (value < 80) return "Functioning democracy";
  return "Healthy democracy";
}

/**
 * Pure scoring seam for the liberal-democracy Governance Style spirit.
 * Political direction compares mirrored left/right families. Democratic
 * health uses a disjoint institutional basket, so neither axis judges the
 * other.
 */
export function scoreGovernanceStyle(
  values: MetricValues,
  competition: DemocraticCompetition | null = null
): GovernanceStyleScore {
  const leftRight = leftRightScore(values);
  const democraticHealth = rounded(democraticHealthScore(values) - (competition?.penalty ?? 0));
  return {
    name: "Governance Style",
    variant: "liberal-democracy",
    leftRight: { value: leftRight, label: leftRightLabel(leftRight) },
    democraticHealth: {
      value: democraticHealth,
      label: democraticHealthLabel(democraticHealth),
    },
    competition,
  };
}

/** Selection only. One-party mechanics never feed the score itself. */
export function supportsGovernanceStyle(governmentType: GovernmentType): boolean {
  return governmentType !== "onePartyState";
}
