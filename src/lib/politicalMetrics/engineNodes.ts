/**
 * The metric engine's POLITICAL nodes, evaluated as pure target functions.
 *
 * The engine's registry models political outcomes causally — education
 * attainment from per-capita education spending, health outcomes from health
 * spending, public safety from inequality. Those nodes used to own a stored
 * legacy value. They no longer store anything: each one contributes a per-turn
 * TARGET, which {@link engineTermFor} converts into a bounded addend on the
 * board family it maps to, and the board's own `driftStep` supplies the
 * smoothing.
 *
 * WHY `compute()` DIRECTLY AND NOT `evalNode`. `evalNode` is the coexistence
 * primitive: it blends the node's `simTarget` with a policy delta measured
 * against a stored `simBaseline`, then EMAs the baseline forward. Every part of
 * that assumes the node OWNS a persisted value. Called with no stored baseline
 * it deliberately collapses to `value ≈ policyValue` — which here would mean
 * the target always equalled the board's current value and the engine term was
 * always zero. The causal signal IS `simTarget`, so this takes it directly.
 *
 * Dropping the EMA is a simplification, not a loss: the board already smooths
 * via `driftStep`, and running both would be two smoothing mechanisms fighting
 * over the same number.
 *
 * TOPO ORDER SURVIVES FILTERING. `METRIC_REGISTRY_SORTED` is sorted over the
 * whole registry, and a subsequence of a topologically ordered list is still
 * topologically ordered, so filtering to the political nodes keeps every
 * same-turn dependency resolved before its dependants run. Dependencies on
 * ECONOMIC nodes are not evaluated here at all — they arrive pre-resolved in
 * `legacy`, which is exactly how the engine treats any non-registry input.
 */
import { applyBounds } from "@/lib/metricEngine/bounds";
import { METRIC_REGISTRY_SORTED } from "@/lib/metricEngine/registry";
import type { EngineNodeContext, NodeId, RegistryNode } from "@/lib/metricEngine/types";
import { MACRO_CATEGORIES } from "@/lib/macroMetrics/paths";

/**
 * Registry nodes whose category the political board owns.
 *
 * Derived from the same `MACRO_CATEGORIES` set the storage split uses, so a
 * category can never be political here and macro there.
 */
export const POLITICAL_NODES: RegistryNode[] = METRIC_REGISTRY_SORTED.filter(
  (n) => !MACRO_CATEGORIES.has(n.categoryId)
);

export interface PoliticalNodeInput {
  countryId: string;
  stateId: string;
  /**
   * Pre-resolved "category.metricId" values for this region: the board
   * projected back into legacy units, plus the macro doc's own categories.
   * Serves as `current` seed, `prev` (for {lagged} edges) and `policyValue`.
   */
  legacy: Record<string, number>;
  /** Per-capita spend by budget category. */
  spending: Record<string, number>;
  /** Cross-collection provider payloads, keyed by provider name. */
  providers: Record<string, unknown>;
}

/**
 * This turn's causal target per political node, keyed by "category.metricId".
 *
 * A node with no `compute` is a ROOT — a policy input, not a modelled outcome —
 * and is omitted rather than echoed back. Echoing it would feed the board a
 * "target" identical to its own current value, contributing a guaranteed zero
 * and diluting the average for every family that root shares.
 *
 * A node whose `compute` returns a non-finite number is dropped for the same
 * reason it must never be persisted: one misauthored divide-by-zero would
 * otherwise poison the family average for the whole region.
 */
export function politicalNodeTargets(input: PoliticalNodeInput): Record<string, number> {
  const current: Record<NodeId, number> = { ...input.legacy };
  const targets: Record<string, number> = {};

  for (const node of POLITICAL_NODES) {
    if (!node.compute) continue;
    const ctx: EngineNodeContext = {
      countryId: input.countryId,
      current,
      prev: input.legacy,
      // Unused: nothing here calls evalNode, so there is no baseline to carry.
      prevSimBaseline: {},
      providers: input.providers,
      spending: input.spending,
      policyValue: node.id in input.legacy ? input.legacy[node.id] : Number.NaN,
      targetNudge: 0,
      envelope: null,
    };
    const raw = node.compute(ctx);
    if (!Number.isFinite(raw)) continue;
    const bounded = applyBounds(raw, node.bounds);
    targets[node.id] = bounded;
    current[node.id] = bounded;
  }

  return targets;
}
