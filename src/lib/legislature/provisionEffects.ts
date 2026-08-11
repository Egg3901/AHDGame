import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import { effectTargetLabelFromMetricId } from "@/lib/legislature/metricLabels";
import { pushesValueUp } from "@/lib/utils/policyDirection";
import type { MetricCategoryId } from "@/lib/db/types";

export interface ProvisionEffectChip {
  metric: string;
  direction: "up" | "down";
  isGood: boolean;
}

interface ComputeChipsParams {
  effectTargetsWeighted?: { metricCategoryId: string; metricId: string; weight: number }[];
  /** Proposed option's graded intensity (−1..+1, from optionIntensity). */
  proposedIntensity: number;
  /** Current law's graded intensity (−1..+1); 0 (center) when no current law. */
  currentIntensity?: number;
}

/** Per-metric projected-effect chips expressing the DELTA vs current law.
 * Extracted from billEnrichment's inline computation so the national and
 * state bill pages stay in lockstep. The delta uses graded option intensity
 * (Bug #0962), so a same-side change of INTENSITY (16%→8% tax, Moderate→Maximum)
 * still shows chips; only a literal no-op (identical option) yields zero delta. */
export function computeProvisionEffectChips({
  effectTargetsWeighted,
  proposedIntensity,
  currentIntensity = 0,
}: ComputeChipsParams): ProvisionEffectChip[] {
  const deltaIntensity = proposedIntensity - currentIntensity;
  const out: ProvisionEffectChip[] = [];
  const seen = new Set<string>();
  for (const target of effectTargetsWeighted ?? []) {
    const weightedDelta = deltaIntensity * target.weight;
    if (weightedDelta === 0) continue;
    const metric = effectTargetLabelFromMetricId(target.metricId);
    if (seen.has(metric)) continue;
    seen.add(metric);
    const isHigherBetter =
      getMetricDefinition(target.metricCategoryId as MetricCategoryId, target.metricId)
        ?.isHigherBetter ?? true;
    const goesUp = pushesValueUp(weightedDelta, isHigherBetter);
    out.push({ metric, direction: goesUp ? "up" : "down", isGood: goesUp === isHigherBetter });
    if (out.length >= 4) break;
  }
  return out;
}
