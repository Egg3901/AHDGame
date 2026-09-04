/**
 * Per-phase Mongo round-trip profiler.
 *
 * Turn time in production is dominated by round-trip latency, not CPU: Mongo
 * is remote, so every command costs milliseconds of network before any work
 * happens. That makes wall clock a poor guide when profiling locally, where a
 * round trip is ~0.05ms and a phase doing thousands of serial queries looks
 * fast. Round-trip COUNT is latency-independent, so it ranks phases the same
 * way locally as it does on production.
 *
 * This counts commands per turn phase by bracketing each phase in
 * `runPhase` (src/simulation/engine/turnPhaseRuntime.ts) and attributing every
 * command the driver reports to whichever phase is open. Attribution is
 * approximate by nature — a phase that awaits concurrent work can overlap the
 * next — but it is more than accurate enough to find the N+1s, which stand out
 * by an order of magnitude.
 *
 * It reports the phase and the collection, not the call site. Capturing a
 * stack here does not work: this runs inside the driver's event emitter, so
 * every frame is driver internals with no application code on it. Take the
 * phase+collection pair and grep for that collection within the phase.
 *
 * Off unless AHD_TURN_ROUNDTRIP_PROFILE=1. When off, every function here is a
 * boolean check on the hot path and nothing is allocated.
 */

/** Commands per phase, and within a phase, per collection. */
type PhaseCounts = { total: number; byCollection: Map<string, number> };

interface ProfilerState {
  counts: Map<string, PhaseCounts>;
  currentPhase: string | null;
  enabled: boolean | null;
}

declare global {
  var _ahdRoundTripProfiler: ProfilerState | undefined;
}

/**
 * State lives on globalThis, not in module scope.
 *
 * Next bundles the server into several chunks, and a module imported from two
 * of them is instantiated twice. The counter is incremented from the Mongo
 * driver monitor (reached via @/lib/mongodb) and read from the turn runner, so
 * with module-level state each side gets its own copy and every turn reports
 * zero. Same reason `mongodb.ts` hangs its client promise off globalThis.
 */
function state(): ProfilerState {
  globalThis._ahdRoundTripProfiler ??= {
    counts: new Map(),
    currentPhase: null,
    enabled: null,
  };
  return globalThis._ahdRoundTripProfiler;
}

/** Read once: this is consulted on every Mongo command in the process. */
export function roundTripProfilingEnabled(): boolean {
  const s = state();
  if (s.enabled === null) s.enabled = process.env.AHD_TURN_ROUNDTRIP_PROFILE === "1";
  return s.enabled;
}

/** Test seam: re-read the env flag and drop any collected counts. */
export function resetRoundTripProfiler(): void {
  const s = state();
  s.enabled = null;
  s.currentPhase = null;
  s.counts.clear();
}

export function beginPhaseProfiling(phase: string): void {
  if (!roundTripProfilingEnabled()) return;
  const s = state();
  s.currentPhase = phase;
  if (!s.counts.has(phase)) s.counts.set(phase, { total: 0, byCollection: new Map() });
}

export function endPhaseProfiling(phase: string): void {
  if (!roundTripProfilingEnabled()) return;
  // Only clear if this phase is still the open one; phases do not nest, but a
  // late async tail from a previous phase must not blank the current pointer.
  const s = state();
  if (s.currentPhase === phase) s.currentPhase = null;
}

/** Called by the driver command monitor for every non-ignored command. */
export function recordRoundTrip(collection: string): void {
  if (!roundTripProfilingEnabled()) return;
  const s = state();
  const phase = s.currentPhase ?? "(outside any phase)";
  let entry = s.counts.get(phase);
  if (!entry) {
    entry = { total: 0, byCollection: new Map() };
    s.counts.set(phase, entry);
  }
  entry.total += 1;
  entry.byCollection.set(collection, (entry.byCollection.get(collection) ?? 0) + 1);
}

export interface RoundTripPhaseReport {
  phase: string;
  roundTrips: number;
  /** The collections this phase talks to most, heaviest first. */
  topCollections: { collection: string; roundTrips: number }[];
}

/** Phases by round-trip count, heaviest first. Does not clear the counters. */
export function roundTripReport(topPhases = 20): RoundTripPhaseReport[] {
  return [...state().counts.entries()]
    .map(([phase, entry]) => ({
      phase,
      roundTrips: entry.total,
      topCollections: [...entry.byCollection.entries()]
        .map(([collection, roundTrips]) => ({ collection, roundTrips }))
        .sort((a, b) => b.roundTrips - a.roundTrips)
        .slice(0, 3),
    }))
    .sort((a, b) => b.roundTrips - a.roundTrips)
    .slice(0, topPhases);
}

export function totalRoundTrips(): number {
  let total = 0;
  for (const entry of state().counts.values()) total += entry.total;
  return total;
}

/**
 * Render the profile for the turn log. Returns null when profiling is off, so
 * callers can skip the work entirely.
 */
export function formatRoundTripReport(topPhases = 20): string | null {
  if (!roundTripProfilingEnabled()) return null;
  const report = roundTripReport(topPhases);
  if (report.length === 0) return null;
  const total = totalRoundTrips();
  const lines = [`[roundtrips] ${total} Mongo round trips this turn, top ${report.length} phases:`];
  for (const row of report) {
    const share = total > 0 ? ((row.roundTrips / total) * 100).toFixed(1) : "0.0";
    const where = row.topCollections.map((c) => `${c.collection} x${c.roundTrips}`).join(", ");
    lines.push(
      `  ${String(row.roundTrips).padStart(6)}  ${share.padStart(5)}%  ${row.phase}  (${where})`
    );
  }
  return lines.join("\n");
}
