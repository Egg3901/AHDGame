import { applyBounds, applyCircuitBreaker, roundTo } from "./bounds";
import type { EngineNodeContext, RegistryNode } from "./types";

export interface NodeEvalResult {
  value: number;
  simBaseline: number;
}

/**
 * The coexistence primitive (spec P0 "Per-turn evaluation"; mirrors gdpGrowth.ts
 * sectorBaseline/policyDelta). processStateMetrics has already written the
 * policy-adjusted value (ctx.policyValue) BEFORE the engine runs. We:
 *   policyDelta    = policyValue − prev.simBaseline        (cold-start → 0)
 *   simTarget      = compute(ctx)
 *   newSimBaseline = inertia·prev.simBaseline + (1−inertia)·simTarget
 *   value          = clamp(newSimBaseline + cappedPolicyDelta, bounds)
 * so the policy contribution is preserved, not eroded, and the two phases don't
 * oscillate.
 */
export function evalNode(
  node: RegistryNode,
  ctx: EngineNodeContext,
  stateId: string
): NodeEvalResult {
  // §6.3 (P7b): an economic-model synergy nudge shifts the TARGET (added before the
  // EMA), so the value settles at compute+nudge rather than accumulating. 0 by default.
  // Era envelope: cap the target BEFORE the EMA — a value-only clamp would let the
  // persisted baseline saturate toward the modern target all era and snap the value
  // to modern one turn after the window opens.
  const envelopeCap = ctx.envelope?.kind === "ceiling" ? ctx.envelope.limit : null;
  const rawSimTarget =
    (node.compute ? node.compute(ctx) : ctx.policyValue) + (ctx.targetNudge ?? 0);
  const simTarget = envelopeCap != null ? Math.min(rawSimTarget, envelopeCap) : rawSimTarget;

  // policyValue is the THIS-turn policy-adjusted value processStateMetrics wrote
  // (the delta numerator). When it is absent/corrupt, fall back to simTarget so
  // the delta is 0 — exactly gdpGrowth.ts's `prevGdpGrowth ?? rawGdpGrowth`
  // numerator fallback (a fresh metric must not jump). typeof NaN === "number",
  // so test finiteness explicitly.
  const prevValue = Number.isFinite(ctx.policyValue) ? ctx.policyValue : simTarget;

  // Cold-start (N7): a missing/corrupt prev baseline falls back to simTarget,
  // mirroring gdpGrowth.ts's `prevSectorBaseline ?? rawGdpGrowth` subtrahend.
  const prevRaw = ctx.prevSimBaseline[node.id];
  const prevSimBaseline = Number.isFinite(prevRaw) ? prevRaw : simTarget;
  const rawDelta = prevValue - prevSimBaseline;
  const cap = node.maxPolicyDelta ?? Infinity;
  // S8: opt-in per-turn delta decay. Because next turn's rawDelta is exactly
  // this turn's written delta (value − simBaseline round-trips through
  // stateMetrics), multiplying here compounds geometrically — a one-time crisis
  // shock erodes toward the simulated baseline instead of being frozen forever.
  // Default 1 preserves legacy behavior for every non-opted-in node.
  const decay = node.policyDeltaDecay ?? 1;
  const policyDelta = Math.max(-cap, Math.min(cap, rawDelta)) * decay;

  const decimals = node.decimals ?? 3;
  // Era envelope: bound the PERSISTED baseline too (a prior above-cap baseline
  // — e.g. the window just tightened — must not survive the EMA).
  const emaBaseline = node.inertia * prevSimBaseline + (1 - node.inertia) * simTarget;
  const newSimBaseline = roundTo(
    applyBounds(
      envelopeCap != null ? Math.min(emaBaseline, envelopeCap) : emaBaseline,
      node.bounds
    ),
    decimals
  );
  // Era envelope: clamp the FINAL value as well — policy deltas from bills or
  // cabinet effects hitting a pre-window metric must not leak past the cap.
  let value = newSimBaseline + policyDelta;
  if (envelopeCap != null) value = Math.min(value, envelopeCap);

  // NaN-output guard: a misauthored compute() (e.g. divide-by-zero) or a
  // no-compute node with no stored value could yield a non-finite value, which
  // would persist to stateMetrics and poison the metric forever (the same
  // failure class gdpGrowth.ts rejects for prev values). Fall back to the last
  // finite value, else the lower bound — never write NaN.
  if (!Number.isFinite(value)) {
    const safeFallback = Number.isFinite(ctx.prev[node.id]) ? ctx.prev[node.id] : node.bounds[0];
    return {
      value: roundTo(applyBounds(safeFallback, node.bounds), decimals),
      simBaseline: safeFallback,
    };
  }

  if (node.circuitBreaker !== undefined && Number.isFinite(ctx.prev[node.id])) {
    value = applyCircuitBreaker(ctx.prev[node.id], value, node.circuitBreaker, node.id, stateId);
  }
  value = roundTo(applyBounds(value, node.bounds), decimals);
  return { value, simBaseline: newSimBaseline };
}
