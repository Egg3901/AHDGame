import type { MetricCategoryId } from "@/lib/db/types";

/** Fully-qualified node id, e.g. "economic.gdpGrowth". */
export type NodeId = string;

export type NodeKind = "stock" | "derived" | "root";

/** An input edge. A bare string is a same-turn metric/stock read. */
export type InputRef =
  | NodeId
  | { lagged: NodeId } // reads LAST turn's value (breaks cycles)
  | { spending: string } // per-capita spending for a budget category
  | { provider: string }; // a cross-collection aggregate (R1)

/** Read-side context handed to a node's compute()/integrate(). */
export interface EngineNodeContext {
  /** The country this state belongs to (e.g. "US", "UK"). Lets a node pick a
   *  country-appropriate model — e.g. universityEnrollment is HS-grad-driven in
   *  the US and GCSE-driven elsewhere (#909). Absent in bare test contexts. */
  countryId?: string;
  /** This-turn values of already-evaluated nodes (topo order guarantees readiness). */
  current: Record<NodeId, number>;
  /** Last-turn persisted values (for {lagged} edges and prev.simBaseline). */
  prev: Record<NodeId, number>;
  /** Last-turn simBaseline per node (coexistence). */
  prevSimBaseline: Record<NodeId, number>;
  /**
   * Per-state provider payloads keyed by provider name (R1). The value shape is
   * provider-specific (e.g. sector lists + tax rates), so it is `unknown` here;
   * a node's compute() casts it to the payload type it expects.
   */
  providers: Record<string, unknown>;
  /** Per-capita spending by budget category. */
  spending: Record<string, number>;
  /** Policy-adjusted current value written by processStateMetrics this turn. */
  policyValue: number;
  /**
   * §6.3 (P7b) economic-model synergy nudge added to this node's TARGET before the
   * EMA, so the value settles at `compute + nudge` (smoothed, not cumulative).
   * Defaults to 0 — parity-neutral when no model synergy targets this node.
   */
  targetNudge?: number;
  /**
   * Era envelope (metric era catalog): clamps BOTH the pre-EMA simTarget /
   * persisted simBaseline AND the final value, so a windowed metric can neither
   * saturate toward modern targets while hidden (baseline leak) nor jump via a
   * policy delta (value leak). Absent/null ⇒ no clamp — byte-identical legacy.
   * Wave 1: ceilings only (higher-is-better adoption metrics).
   */
  envelope?: { limit: number; kind: "ceiling" } | null;
}

export interface RegistryNode {
  id: NodeId;
  categoryId: MetricCategoryId;
  metricId: string;
  kind: NodeKind;
  inputs: InputRef[];
  /** [min, max] — authoritative; the engine owns bounds (S1). */
  bounds: [number, number];
  /** EMA weight on the prior simBaseline (0..1). Higher = slower. */
  inertia: number;
  /** Decimal places for the written value + simBaseline (default 3). gdpGrowth=3, unemployment=2. */
  decimals?: number;
  /** Optional cap on |policyDelta| preserved across smoothing (gdpGrowth MAX_POLICY_DELTA=8). Use 0 for value-EMA metrics with no policy-delta preservation (e.g. unemployment). */
  maxPolicyDelta?: number;
  /**
   * Per-turn RETENTION factor on the preserved policy delta (0..1). Default 1 =
   * legacy behavior (the delta is preserved in full forever). Opt-in for
   * shock-absorbing sentiment nodes (S8): a one-time crisis `$inc` shows up as
   * a policy delta under the coexistence model, and without decay it is frozen
   * permanently — inertia decays the BASELINE, not the delta. e.g. 0.9 → a
   * shock retains 90% each turn (half-life ~6.6 turns).
   */
  policyDeltaDecay?: number;
  /** Per-turn movement beyond this is clamped + logged (circuit-breaker). */
  circuitBreaker?: number;
  /** derived/root: compute this turn's simulated target. */
  compute?: (ctx: EngineNodeContext) => number;
}

export type MetricRegistry = Map<NodeId, RegistryNode>;

/** Resolve the dependency NodeIds of an input list, EXCLUDING lagged edges. */
export function sameTurnDeps(inputs: InputRef[]): NodeId[] {
  const out: NodeId[] = [];
  for (const i of inputs) {
    if (typeof i === "string") out.push(i);
    // {lagged}/{spending}/{provider} are NOT same-turn node deps
  }
  return out;
}

export function nodeKey(categoryId: MetricCategoryId, metricId: string): NodeId {
  return `${categoryId}.${metricId}`;
}
