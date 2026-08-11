import { evalNode } from "@/lib/metricEngine/coexistence";
import type { NodeId, RegistryNode } from "@/lib/metricEngine/types";
import { calculateMetricTarget, computeTickRates, type ActivePolicy } from "@/lib/policyEffects";
import { applyPolicyDecay } from "@shared/constants/formulas";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import type { MetricCategoryId } from "@/lib/db/types/stateMetrics";
import type { LegislationType } from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";

/**
 * Faithful in-memory simulation of how an enacted law moves a metric category's
 * metrics over N turns. It mirrors the PRODUCTION two-layer per-turn pipeline so a
 * sim's "expected movement" is the real movement, not a toy approximation:
 *
 *   Layer 1 — policy (processStateMetrics): each metric's value decays toward
 *     `calculateMetricTarget(baseline, activeLaws…)` (baseline + Σ weighted
 *     `effectTargetsWeighted` contributions, with optional half-life decay), then
 *     additive `ratePerTurn` ticks from `computeTickRates`. This yields the
 *     "policy-adjusted value".
 *   Layer 2 — engine (evalNode/coexistence): for REGISTRY-NODE metrics, the
 *     policy-adjusted value is fed as `policyValue`; the node outputs
 *     `simBaseline + cappedPolicyDelta` (its `compute()` target tracks spending /
 *     inputs, the policy delta is the law's sustained offset).
 *
 * Two metric kinds, matching production:
 *   • ROOT metrics (e.g. healthcare.uninsuredRate) — policy-controlled, NOT engine
 *     nodes. Layer 1 only; exposed each turn as an input the nodes read.
 *   • NODE metrics (e.g. healthcare.lifeExpectancy) — Layer 1 (→ policyValue) then
 *     Layer 2 (→ final value).
 *
 * Pure: no DB, no clock. Deterministic. Drives the per-category
 * `*.legislation.sim.test.ts` suites. Run an identical CONTROL (policies: [])
 * alongside the LAW run and compare — divergence isolates the law's effect from
 * the engine's baseline drift.
 */
export type LegTypeMap = Map<string, LegislationType>;

/** A policy-controlled input metric (not an engine node). */
export interface RootMetric {
  /** Full id, e.g. "healthcare.uninsuredRate" (the key nodes read it under). */
  id: NodeId;
  categoryId: MetricCategoryId;
  metricId: string;
  initial: number;
}

export interface SimInputs {
  /** Engine nodes for the category under test (already RegistryNode[]). */
  nodes: RegistryNode[];
  /** Policy-controlled root inputs (policy layer only), fed to node computes. */
  roots?: RootMetric[];
  /** Baseline doc — calculateMetricTarget reads `.baselines[cat][metric]` (default 50). */
  baselineDoc: StateMetricBaseline | null;
  /** Initial node values (default: mid-bounds). Keyed by node id. */
  initial?: Partial<Record<NodeId, number>>;
  /** Constant inputs the nodes read that are neither roots nor nodes. */
  external?: Record<NodeId, number>;
  /** Budget spending vector (the engine spending channel). */
  spending?: Record<string, number>;
  /** Providers for compute() nodes (usually {} outside the economic tier). */
  providers?: Record<string, unknown>;
  /** Enacted laws under test (empty = control run). */
  policies: ActivePolicy[];
  legTypeMap: LegTypeMap;
  turns: number;
  /** Pure-engine warmup turns to anchor node baselines (default 240). */
  warmupTurns?: number;
}

export interface SimOutput {
  /** Final value per node + root id. */
  final: Record<NodeId, number>;
  /** Trajectory per node + root id (length turns + 1, including t0). */
  trajectory: Record<NodeId, number[]>;
}

const midBounds = (n: RegistryNode) => (n.bounds[0] + n.bounds[1]) / 2;
const clampRoot = (v: number, cat: MetricCategoryId, metric: string) => {
  const def = getMetricDefinition(cat, metric);
  return Math.max(def?.minValue ?? 0, Math.min(def?.maxValue ?? 100, v));
};

/** Warm engine + root state shared by the control and law runs. */
export interface WarmState {
  value: Record<NodeId, number>;
  baseline: Record<NodeId, number>;
  rootValue: Record<NodeId, number>;
}

/**
 * Pure-engine warmup at PRE-LAW (control) conditions: nodes run with
 * `policyValue = prevValue` (no policy injection — the engine's own "preserve the
 * seed-level policy delta, let the baseline track compute" behavior), roots held at
 * their initial values, for `warmupTurns`. Returns the settled state. Control and law
 * BOTH start here so any divergence isolates the law (raised spending + root effects),
 * exactly like the proven category sim tests (warm at baseline, then perturb).
 */
export function warmup(input: SimInputs): WarmState {
  const turns = input.warmupTurns ?? 240;
  const value: Record<NodeId, number> = {};
  const baseline: Record<NodeId, number> = {};
  for (const n of input.nodes) value[n.id] = input.initial?.[n.id] ?? midBounds(n);
  const rootValue: Record<NodeId, number> = {};
  for (const r of input.roots ?? []) rootValue[r.id] = r.initial;
  const external = input.external ?? {};
  const spending = input.spending ?? {};
  const providers = input.providers ?? {};

  for (let t = 0; t < turns; t++) {
    const current: Record<NodeId, number> = { ...external, ...rootValue };
    const prev: Record<NodeId, number> = { ...value, ...external, ...rootValue };
    const next: Record<NodeId, number> = {};
    const nextBaseline: Record<NodeId, number> = {};
    for (const n of input.nodes) {
      const r = evalNode(
        n,
        { current, prev, prevSimBaseline: baseline, providers, spending, policyValue: value[n.id] },
        "sim-warmup"
      );
      next[n.id] = r.value;
      nextBaseline[n.id] = r.simBaseline;
      current[n.id] = r.value;
    }
    for (const n of input.nodes) {
      value[n.id] = next[n.id];
      baseline[n.id] = nextBaseline[n.id];
    }
  }
  return { value: { ...value }, baseline: { ...baseline }, rootValue: { ...rootValue } };
}

/**
 * Run one scenario forward from a shared warm state.
 *   • NODES — pure engine (`policyValue = prevValue`): the law reaches them through
 *     raised `spending` and through ROOT inputs, never a direct policy override (this
 *     mirrors the §4.7 design that routes funding laws via spending + the coverage
 *     root rather than double-counting effectTargets onto outcome nodes).
 *   • ROOTS — policy layer: value decays toward `calculateMetricTarget(baseline,
 *     activeLaws)` + additive `ratePerTurn` ticks. This is the law's direct effect on
 *     policy-controlled metrics (e.g. uninsuredRate).
 */
export function runLegislationSim(input: SimInputs, warm: WarmState): SimOutput {
  const value: Record<NodeId, number> = { ...warm.value };
  const baseline: Record<NodeId, number> = { ...warm.baseline };
  const rootValue: Record<NodeId, number> = { ...warm.rootValue };
  const trajectory: Record<NodeId, number[]> = {};
  for (const n of input.nodes) trajectory[n.id] = [value[n.id]];
  for (const r of input.roots ?? []) trajectory[r.id] = [rootValue[r.id]];

  const external = input.external ?? {};
  const spending = input.spending ?? {};
  const providers = input.providers ?? {};
  const tickRates = computeTickRates(input.policies, input.legTypeMap);

  for (let t = 0; t < input.turns; t++) {
    // ── Roots: policy layer (decay toward law target + ticks) ──
    for (const r of input.roots ?? []) {
      const target = calculateMetricTarget(
        input.baselineDoc,
        r.categoryId,
        r.metricId,
        input.policies,
        input.legTypeMap,
        t
      );
      let v = applyPolicyDecay(rootValue[r.id], target);
      const rate = tickRates[r.categoryId]?.[r.metricId] ?? 0;
      if (rate) v += rate;
      rootValue[r.id] = clampRoot(v, r.categoryId, r.metricId);
    }

    // ── Nodes: pure engine, reading roots + external as inputs ──
    const current: Record<NodeId, number> = { ...external, ...rootValue };
    const prev: Record<NodeId, number> = { ...value, ...external, ...rootValue };
    const nextValue: Record<NodeId, number> = {};
    const nextBaseline: Record<NodeId, number> = {};
    for (const n of input.nodes) {
      const r = evalNode(
        n,
        { current, prev, prevSimBaseline: baseline, providers, spending, policyValue: value[n.id] },
        "sim"
      );
      nextValue[n.id] = r.value;
      nextBaseline[n.id] = r.simBaseline;
      current[n.id] = r.value;
    }
    for (const n of input.nodes) {
      value[n.id] = nextValue[n.id];
      baseline[n.id] = nextBaseline[n.id];
      trajectory[n.id].push(value[n.id]);
    }
    for (const r of input.roots ?? []) trajectory[r.id].push(rootValue[r.id]);
  }

  return { final: { ...value, ...rootValue }, trajectory };
}

/** Build a single-law active-policy + legType map from a real seed LegislationType. */
export function enactedLaw(
  law: LegislationType,
  opts: { effectDirection: -1 | 0 | 1; policyOptionId?: string; enactedTurn?: number }
): { policy: ActivePolicy; legTypeMap: LegTypeMap } {
  const policy = {
    _id: `sim_${law._id}`,
    stateId: "federal",
    legislationTypeId: law._id,
    effectDirection: opts.effectDirection,
    policyOptionId: opts.policyOptionId,
    enactedTurn: opts.enactedTurn ?? 0,
    scopeMultiplier: 1,
  } as unknown as ActivePolicy;
  return { policy, legTypeMap: new Map([[law._id, law]]) };
}

/** Pretty per-metric report: control_final → law_final, Δ, and direction arrow. */
export function reportTrajectory(
  label: string,
  ids: NodeId[],
  control: SimOutput,
  law: SimOutput
): string {
  const lines = [`\n══ ${label} (240-turn) ══`, "metric".padEnd(38) + "control →  law      Δ"];
  for (const id of ids) {
    const c = control.final[id];
    const l = law.final[id];
    const d = l - c;
    const arrow = Math.abs(d) < 0.05 ? "·" : d > 0 ? "▲" : "▼";
    lines.push(
      id.padEnd(38) +
        `${c.toFixed(2).padStart(7)} → ${l.toFixed(2).padStart(7)}  ${d >= 0 ? "+" : ""}${d.toFixed(2)} ${arrow}`
    );
  }
  return lines.join("\n");
}
