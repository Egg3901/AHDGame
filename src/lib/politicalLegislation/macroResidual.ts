/**
 * Bridge B — macroeconomic reality as a bounded addend to the political residual.
 *
 * Before this, processPoliticalMetricsDynamics drifted every value toward its
 * enacted-law target and nothing else: the board was a pure readout of the law
 * book, and a depression could not dent economy.stability.
 *
 * This adds a per-turn term derived from macroMetrics, summed with the STORED
 * structural residual when composing the target. It is deliberately NOT written
 * back to `doc.residuals`: that field means "the permanent structural gap set at
 * reset", the dynamics self-heal recomputes it as `value − composedLawTarget`,
 * and polluting it with a transient macro term would corrupt every later heal.
 *
 * Two safety properties:
 *   1. Macro at the law-implied target ⇒ 0, so behavior is unchanged wherever
 *      the economy matches what the law book predicts.
 *   2. MACRO_BOUND caps the term well inside the range the law ladder spans, so
 *      macro BENDS the equilibrium rather than overriding it. The law still wins.
 *
 * The family→macro-source map is TIER2_SOURCES (macroFamilySources), shared
 * with the non-playable derivation — the families with macro sources are
 * exactly the ones macro conditions should move, so there is one map, not two.
 * It lives outside derive/ so this per-turn path does not import the
 * offline-only derivation library.
 */
import { TIER2_SOURCES } from "@/lib/politicalMetrics/macroFamilySources";
import { politicalScoreFromLegacyValue } from "@/lib/politicalMetrics/derive/legacyInversion";

/** Fraction of the macro-vs-law gap that reaches the target. */
export const MACRO_WEIGHT = 0.5;
/** Hard cap in board points, either direction. Keeps the law signal dominant. */
export const MACRO_BOUND = 12;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The bounded macro term for one family, or 0 when the family has no macro
 * sources or the region has no macro data for them.
 */
export function macroResidualFor(
  familyId: string,
  lawTarget: number,
  macro: Record<string, number>,
  countryId: string
): number {
  const paths = TIER2_SOURCES[familyId];
  if (!paths?.length) return 0;

  const scores: number[] = [];
  for (const path of paths) {
    const raw = macro[path];
    if (raw == null || !Number.isFinite(raw)) continue;
    const [category, metricId] = path.split(".");
    const score = politicalScoreFromLegacyValue(category, metricId, raw, countryId);
    if (score != null) scores.push(score);
  }
  if (scores.length === 0) return 0;

  const macroScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  return clamp((macroScore - lawTarget) * MACRO_WEIGHT, -MACRO_BOUND, MACRO_BOUND);
}
