/**
 * Sub-step timing inside a turn phase (#2689).
 *
 * Phase intervals already cover the whole turn; what is missing is where the
 * time goes inside the heavy phases. A phase creates a marker and calls
 * `mark(name)` at the end of each sequential segment. Each mark records the
 * wall time since the previous mark and, when round-trip counting is on, the
 * phase's Mongo round trips issued in that segment. Marks with the same name
 * accumulate. `runPhase` takes the recorded steps when the phase completes and
 * persists them on the phase's status in `turnLogs`.
 *
 * Wall time includes interleaving with phases that run concurrently in the
 * same group; round trips do not, because they are attributed by the phase's
 * own trace id. Outside a phase the marker is a no-op.
 *
 * State lives on globalThis for the same reason as the round-trip profiler:
 * Next can instantiate a module twice across server chunks.
 */
import {
  currentTurnPhase,
  phaseRoundTrips,
  roundTripCountsAvailable,
} from "@/lib/observability/mongoRoundTrips";

export type PhaseSubstep = { ms: number; roundTrips?: number; calls: number };
export type PhaseSubsteps = Record<string, PhaseSubstep>;

declare global {
  var _ahdPhaseSubsteps: Map<string, PhaseSubsteps> | undefined;
}

function store(): Map<string, PhaseSubsteps> {
  globalThis._ahdPhaseSubsteps ??= new Map();
  return globalThis._ahdPhaseSubsteps;
}

export type SubstepMarker = { mark(name: string): void };

const NOOP: SubstepMarker = { mark() {} };

export function substepMarker(now: () => number = () => performance.now()): SubstepMarker {
  const phase = currentTurnPhase();
  if (!phase) return NOOP;
  let lastAt = now();
  let lastRoundTrips = phaseRoundTrips(phase);
  return {
    mark(name: string) {
      const at = now();
      // Checked per mark: the monitor may observe its first command after the
      // marker was created, and counts before that are zero, not missing.
      const counting = roundTripCountsAvailable();
      const roundTrips = phaseRoundTrips(phase);
      const steps = store().get(phase) ?? {};
      const step = steps[name] ?? { ms: 0, calls: 0 };
      step.ms += at - lastAt;
      step.calls += 1;
      if (counting) step.roundTrips = (step.roundTrips ?? 0) + (roundTrips - lastRoundTrips);
      steps[name] = step;
      store().set(phase, steps);
      lastAt = at;
      lastRoundTrips = roundTrips;
    },
  };
}

/** Recorded steps for a phase, rounded for storage, and cleared. */
export function takePhaseSubsteps(phase: string): PhaseSubsteps | undefined {
  const steps = store().get(phase);
  store().delete(phase);
  if (!steps || Object.keys(steps).length === 0) return undefined;
  return Object.fromEntries(
    Object.entries(steps).map(([name, step]) => [name, { ...step, ms: Math.round(step.ms) }])
  );
}

/** Drop recorded steps for a phase without persisting them (failure paths). */
export function discardPhaseSubsteps(phase: string): void {
  store().delete(phase);
}
