/**
 * The metric engine's political nodes, expressed as a bounded addend to a
 * family's composed board target.
 *
 * WHY THIS EXISTS. The engine's registry carries 62 political nodes — education
 * attainment from per-capita education spending, health outcomes from health
 * spending, public safety from inequality, and so on. They used to read and
 * write a region's legacy metrics doc. Retiring that collection would have
 * deleted the whole causal channel, because Bridge B covers only 8 of the 63
 * families (the seven `economy.*` plus `society.demography`) and every other
 * family moves on enacted law alone. Budget spending would have stopped
 * affecting education, health, and crime outcomes entirely.
 *
 * So the nodes' MODEL survives and their STORE does not: a node no longer owns
 * a persisted value, it contributes a per-turn TARGET, and the board's own
 * `driftStep` does the smoothing that the node's EMA used to do. One smoothing
 * mechanism instead of two, and no second political representation.
 *
 * SHAPE-IDENTICAL TO BRIDGE B, deliberately. `macroResidualFor` converts macro
 * paths to a family score and returns a bounded gap against the law target;
 * this does the same for engine outputs. Two channels, one composition rule:
 *
 *   target = composeTarget(points, supplement, structural + macroTerm + engineTerm)
 *
 * NOT PERSISTED, for the same reason Bridge B is not: `residuals` means "the
 * structural gap fixed at reset", and the dynamics self-heal recomputes it as
 * `value − composedLawTarget`. Folding a per-turn causal term into it would
 * bake this turn's spending level into the country's permanent equilibrium and
 * corrupt every later heal.
 *
 * BOUNDED so the law ladder still wins. A government that funds schools should
 * bend education outcomes, not overrule the education laws on the books.
 */
import { ADAPTER_TIER1 } from "@/lib/politicalLegislation/marginAdapter";
import { politicalScoreFromLegacyValue } from "./derive/legacyInversion";

/** Fraction of the engine-vs-law gap that reaches the target. */
export const ENGINE_WEIGHT = 0.5;
/** Hard cap in board points, either direction. Mirrors MACRO_BOUND's intent. */
export const ENGINE_BOUND = 12;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * family → the legacy "category.metricId" paths that map onto it.
 *
 * Inverted from `ADAPTER_TIER1` rather than hand-authored: that map is the
 * reviewed legacy↔family correspondence, and a second hand-written copy would
 * drift the moment someone edits one of them. Many-to-one is normal — three
 * education metrics land on `education.universalSchooling` — and the caller
 * averages whichever of them the engine produced this turn.
 */
export const ENGINE_PATHS_BY_FAMILY: Record<string, string[]> = (() => {
  const byFamily: Record<string, string[]> = {};
  for (const [legacyPath, familyId] of Object.entries(ADAPTER_TIER1)) {
    (byFamily[familyId] ??= []).push(legacyPath);
  }
  return byFamily;
})();

/**
 * The bounded engine term for one family.
 *
 * `nodeOutputs` is keyed by legacy "category.metricId" and carries this turn's
 * node results in their own legacy units. Returns 0 when the family has no
 * engine-driven paths or the engine produced none of them, which is the
 * no-signal answer — NOT a nudge toward the middle of the scale.
 *
 * @param familyId   board family being composed
 * @param lawTarget  the law-implied target, already composed with the residual
 * @param nodeOutputs legacy-unit node results for this region
 * @param countryId  scopes the era band used by the inversion
 * @param year       game year, when era-aware scoring is wanted
 */
export function engineTermFor(
  familyId: string,
  lawTarget: number,
  nodeOutputs: Record<string, number>,
  countryId: string,
  year?: number
): number {
  const paths = ENGINE_PATHS_BY_FAMILY[familyId];
  if (!paths?.length) return 0;

  const scores: number[] = [];
  for (const path of paths) {
    const raw = nodeOutputs[path];
    if (raw == null || !Number.isFinite(raw)) continue;
    const [category, metricId] = path.split(".");
    const score = politicalScoreFromLegacyValue(category, metricId, raw, countryId, year);
    if (score != null) scores.push(score);
  }
  if (scores.length === 0) return 0;

  const engineScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  return clamp((engineScore - lawTarget) * ENGINE_WEIGHT, -ENGINE_BOUND, ENGINE_BOUND);
}
