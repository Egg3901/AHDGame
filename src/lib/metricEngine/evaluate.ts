import { evalNode, type NodeEvalResult } from "./coexistence";
import type { EngineNodeContext, NodeId, RegistryNode } from "./types";

export interface EvaluateInput {
  stateId: string;
  /** Country of this state — threaded into each node's ctx for country-aware
   *  models (e.g. universityEnrollment upstream, #909). */
  countryId?: string;
  prev: Record<NodeId, number>;
  prevSimBaseline: Record<NodeId, number>;
  providers: Record<string, unknown>;
  spending: Record<string, number>;
  /** Post-policyEffects stored values, the policyDelta numerator. Absent → NaN (fresh metric). */
  policyValues: Record<NodeId, number>;
  /**
   * Optional initial `current` values for metrics a node reads but that are NOT
   * registry nodes yet (e.g. a derived node reading the policy-adjusted
   * medianIncome before medianIncome is itself animated). Evaluated nodes
   * overwrite their own entry as they run.
   */
  seedCurrent?: Record<NodeId, number>;
  /**
   * §6.3 (P7b) per-node economic-model synergy nudges, added to each node's target
   * before its EMA. Absent → 0 (parity).
   */
  targetNudges?: Record<NodeId, number>;
  /**
   * Era envelopes per node id (metric era catalog): ceiling clamps for windowed
   * animated metrics. Absent → no clamp (parity).
   */
  envelopes?: Record<NodeId, { limit: number; kind: "ceiling" }>;
}

/**
 * Evaluate the whole registry for ONE state. Pure: all DB reads are pre-resolved
 * into the input maps.
 *
 * `orderedNodes` MUST already be topo-sorted (use `METRIC_REGISTRY_SORTED`, or
 * `topoSort(nodes)` in tests) — the sort is done ONCE at module load, not
 * per-state, so the per-turn phase over ~107 states doesn't re-sort each time
 * (perf — spec R4). Topo order guarantees each node's same-turn deps are in
 * `current` before it runs.
 *
 * A node with no stored policy value gets `policyValue = NaN`, so evalNode falls
 * the delta numerator back to its simTarget (delta 0) — a fresh metric takes its
 * computed value, matching gdpGrowth.ts's `?? rawGdpGrowth`.
 */
export function evaluateRegistry(
  orderedNodes: RegistryNode[],
  input: EvaluateInput
): Record<NodeId, NodeEvalResult> {
  const current: Record<NodeId, number> = { ...(input.seedCurrent ?? {}) };
  const results: Record<NodeId, NodeEvalResult> = {};
  for (const node of orderedNodes) {
    const ctx: EngineNodeContext = {
      countryId: input.countryId,
      current,
      prev: input.prev,
      prevSimBaseline: input.prevSimBaseline,
      providers: input.providers,
      spending: input.spending,
      policyValue: node.id in input.policyValues ? input.policyValues[node.id] : NaN,
      targetNudge: input.targetNudges?.[node.id] ?? 0,
      envelope: input.envelopes?.[node.id] ?? null,
    };
    const res = evalNode(node, ctx, input.stateId);
    results[node.id] = res;
    current[node.id] = res.value;
  }
  return results;
}
