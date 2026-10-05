/** Pure reset-law proposal comparison. Neither a fiscal forecast nor a metric writer. */
import type { MetricInterpretation } from "@/lib/resetMetrics/catalog";

export type ChangeVerdict = "good" | "bad" | "neutral" | "context";

export interface MetricChangeInput {
  metricId: string;
  currentValue: number;
  proposedValue: number;
  interpretation: MetricInterpretation;
  /** Only for band metrics; omit until the metric owner has an approved range. */
  preferredRange?: { min: number; max: number };
}

export interface ProposalComparisonInput {
  currentPosition: string;
  proposedPosition: string;
  currentAnnualAllocation: number;
  proposedAnnualAllocation: number;
  metricChanges: readonly MetricChangeInput[];
}

export interface MetricChangePreview {
  metricId: string;
  currentValue: number;
  proposedValue: number;
  delta: number;
  verdict: ChangeVerdict;
}

export interface ProposalComparison {
  isNoChange: boolean;
  currentAnnualAllocation: number;
  proposedAnnualAllocation: number;
  /** Proposed minus superseded allocation; not their sum. */
  annualAllocationDelta: number;
  allocationVerdict: ChangeVerdict;
  metricChanges: MetricChangePreview[];
}

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function bandDistance(value: number, range: { min: number; max: number }): number {
  if (value < range.min) return range.min - value;
  if (value > range.max) return value - range.max;
  return 0;
}

export function metricChangeVerdict(input: MetricChangeInput): ChangeVerdict {
  finite(input.currentValue, "current metric value");
  finite(input.proposedValue, "proposed metric value");
  const delta = input.proposedValue - input.currentValue;
  if (delta === 0) return "neutral";
  if (input.interpretation === "context") return "context";
  if (input.interpretation === "higher") return delta > 0 ? "good" : "bad";
  if (input.interpretation === "lower") return delta < 0 ? "good" : "bad";
  const range = input.preferredRange;
  if (!range) return "context";
  finite(range.min, "preferred range minimum");
  finite(range.max, "preferred range maximum");
  if (range.min > range.max) throw new Error("preferred range minimum exceeds maximum");
  const currentDistance = bandDistance(input.currentValue, range);
  const proposedDistance = bandDistance(input.proposedValue, range);
  if (proposedDistance === currentDistance) return "neutral";
  return proposedDistance < currentDistance ? "good" : "bad";
}

export function compareProposal(input: ProposalComparisonInput): ProposalComparison {
  finite(input.currentAnnualAllocation, "current annual allocation");
  finite(input.proposedAnnualAllocation, "proposed annual allocation");
  if (input.currentAnnualAllocation < 0 || input.proposedAnnualAllocation < 0) {
    throw new Error("annual allocation cannot be negative");
  }
  const annualAllocationDelta = input.proposedAnnualAllocation - input.currentAnnualAllocation;
  const ids = new Set<string>();
  const metricChanges = input.metricChanges.map((metric) => {
    if (ids.has(metric.metricId)) throw new Error(`duplicate metric ${metric.metricId}`);
    ids.add(metric.metricId);
    return {
      metricId: metric.metricId,
      currentValue: metric.currentValue,
      proposedValue: metric.proposedValue,
      delta: metric.proposedValue - metric.currentValue,
      verdict: metricChangeVerdict(metric),
    };
  });
  return {
    isNoChange: input.currentPosition === input.proposedPosition,
    currentAnnualAllocation: input.currentAnnualAllocation,
    proposedAnnualAllocation: input.proposedAnnualAllocation,
    annualAllocationDelta,
    allocationVerdict:
      annualAllocationDelta > 0 ? "bad" : annualAllocationDelta < 0 ? "good" : "neutral",
    metricChanges,
  };
}
