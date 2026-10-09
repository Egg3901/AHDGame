/**
 * Bill metric effects compare the proposed law's frozen modeled pressure with
 * the calibrated current-law choice at full implementation. See
 * reviewedLawMetricEffectDeltas; these estimates do not change observed metrics.
 */
import type { LawChoice } from "./eligibility";

const REVIEWED_CHOICES = [
  "far_left",
  "center_left",
  "center",
  "center_right",
  "far_right",
] as const;

export interface SnapshottedPrimaryMetricEffect {
  metricId: string;
  favorableNormalizedPoints: number;
}

/**
 * Compare a reviewed law proposal's frozen modeled pressure with the pressure
 * represented by the current-law choice at proposal time.
 *
 * The bill stores the proposed effects and current choice. The profile supplies
 * the five reviewed choice values; leave-to-states has no national program
 * pressure. Keeping this subtraction here lets bill-detail hosts share the same
 * portable rule without reaching for the database or current world state.
 */
export function reviewedLawMetricEffectDeltas(input: {
  currentChoice: LawChoice;
  primaryResponse: readonly number[];
  proposedEffects: readonly SnapshottedPrimaryMetricEffect[];
}): SnapshottedPrimaryMetricEffect[] {
  const currentIndex = REVIEWED_CHOICES.indexOf(
    input.currentChoice as (typeof REVIEWED_CHOICES)[number]
  );
  const currentPressure =
    input.currentChoice === "leave_to_states"
      ? 0
      : currentIndex >= 0
        ? input.primaryResponse[currentIndex]
        : undefined;

  if (!Number.isFinite(currentPressure)) return [];

  return input.proposedEffects.flatMap((effect) => {
    if (!Number.isFinite(effect.favorableNormalizedPoints)) return [];
    return [
      {
        metricId: effect.metricId,
        favorableNormalizedPoints: Number(
          (effect.favorableNormalizedPoints - (currentPressure as number)).toFixed(4)
        ),
      },
    ];
  });
}
