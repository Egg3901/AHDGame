import type { AltLinkSignal, AltSignal } from "@/lib/db/types/altDetection";

/**
 * Noisy-OR aggregation for one pairwise link (forensics/alt-detection rework
 * plan §3.2, Phase 5 T5.2):
 *
 *   P = 1 - Π(1 - w_i)
 *
 * so any number of weak signals accumulate but saturate below 1, while one
 * definitive signal (device/oauth, w≈0.95-0.97) alone already dominates the
 * result. Each signal's `contribution` is its MARGINAL effect on the
 * aggregate — `P - P_without_i` — which is what the explainable breakdown
 * (plan §4.8 `SignalBreakdown`) renders as a waterfall.
 */

export interface ScorableSignal {
  type: AltSignal;
  /** Effective weight for this pair (post guards/caps), ∈ [0,1]. */
  weight: number;
  evidence: string;
  detectedAt: Date;
}

export interface ScoreLinkResult {
  /** Aggregate noisy-OR confidence, P ∈ [0,1]. */
  confidence: number;
  /** One entry per input signal, in input order, with `contribution` filled in. */
  contributions: AltLinkSignal[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** `1 - Π(1 - w_i)` over the given weights (already clamped to [0,1]). */
function noisyOr(weights: number[]): number {
  const survival = weights.reduce((product, w) => product * (1 - w), 1);
  return 1 - survival;
}

/**
 * Score one link's signals via noisy-OR and compute each signal's marginal
 * contribution. Pure — O(n^2) in the (small, <=14) signal count, which is
 * cheap enough to recompute per pair rather than optimize.
 */
export function scoreLink(signals: ScorableSignal[]): ScoreLinkResult {
  if (signals.length === 0) {
    return { confidence: 0, contributions: [] };
  }

  const weights = signals.map((s) => clamp01(s.weight));
  const confidence = noisyOr(weights);

  const contributions: AltLinkSignal[] = signals.map((signal, i) => {
    const withoutI = weights.filter((_, j) => j !== i);
    const confidenceWithoutI = noisyOr(withoutI);
    return {
      type: signal.type,
      weight: weights[i],
      contribution: confidence - confidenceWithoutI,
      evidence: signal.evidence,
      detectedAt: signal.detectedAt,
    };
  });

  return { confidence, contributions };
}
