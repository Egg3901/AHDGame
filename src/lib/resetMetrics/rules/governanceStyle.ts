import type { DemocraticCompetition } from "@/lib/governanceStyle/competition";
import {
  democraticHealthLabel,
  leftRightLabel,
  type GovernanceStyleScore,
} from "@/lib/governanceStyle/score";
import type { LegislativePosition } from "@/lib/resetLegislation/catalog";

export type ResetMetricConditionScores = Readonly<Record<string, number | null | undefined>>;

const POSITION_SCORES: Readonly<Record<LegislativePosition, number>> = {
  far_left: 0,
  center_left: 25,
  center: 50,
  center_right: 75,
  far_right: 100,
};

/** V2 observations that describe democratic institutions rather than ideology. */
export const RESET_DEMOCRATIC_HEALTH_WEIGHTS = {
  "43": 0.05, // Social cohesion
  "44": 0.15, // Civic participation beyond voting
  "47": 0.15, // Government transparency
  "48": 0.15, // Corruption, already normalized so higher is favorable
  "49": 0.1, // Public trust
  "50": 0.2, // Civil liberties
  "51": 0.05, // Voter turnout
  "52": 0.1, // Press freedom
  "53": 0.05, // Disinformation exposure, already normalized so higher is favorable
} as const;

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const rounded = (value: number) => Math.round(clamp(value) * 10) / 10;

function mean(values: readonly number[], fallback: number): number {
  if (values.length === 0) return fallback;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function democraticHealth(conditionScores: ResetMetricConditionScores): number {
  let weightedScore = 0;
  let totalWeight = 0;
  for (const [metricId, weight] of Object.entries(RESET_DEMOCRATIC_HEALTH_WEIGHTS)) {
    const score = conditionScores[metricId];
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    weightedScore += clamp(score) * weight;
    totalWeight += weight;
  }
  return totalWeight === 0 ? 50 : weightedScore / totalWeight;
}

/**
 * Portable v2 National Spirit scoring.
 *
 * Political direction describes the current legal settlement. Democratic
 * health is a separate basket of favorable v2 condition scores, reduced only
 * by the established concentration-of-power pressure.
 */
export function scoreResetGovernanceStyle(input: {
  conditionScores: ResetMetricConditionScores;
  legislativePositions: readonly LegislativePosition[];
  competition?: DemocraticCompetition | null;
}): GovernanceStyleScore {
  const leftRight = rounded(
    mean(
      input.legislativePositions.map((position) => POSITION_SCORES[position]),
      50
    )
  );
  const competition = input.competition ?? null;
  const health = rounded(democraticHealth(input.conditionScores) - (competition?.penalty ?? 0));

  return {
    name: "Governance Style",
    variant: "liberal-democracy",
    leftRight: { value: leftRight, label: leftRightLabel(leftRight) },
    democraticHealth: { value: health, label: democraticHealthLabel(health) },
    competition,
  };
}
