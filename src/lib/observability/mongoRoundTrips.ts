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

import { getAuditRequestContext } from "@/lib/observability/context";

/**
 * Per phase: how many commands were issued, and how many documents came back.
 *
 * Both matter and they rank differently. Round trips are what production pays
 * for (remote Mongo, latency per call). Documents returned are what
 * singleplayer pays for (local Mongo, BSON deserialization per document). A
 * phase can be cheap on one and ruinous on the other: one aggregate returning
 * 61,398 documents is a single round trip.
 */
type PhaseCounts = {
  total: number;
  documents: number;
  /** BSON bytes of the documents returned: what deserialization actually costs. */
  bytes: number;
  byCollection: Map<string, { roundTrips: number; documents: number; bytes: number }>;
};

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
  if (!s.counts.has(phase)) {
    s.counts.set(phase, { total: 0, documents: 0, bytes: 0, byCollection: new Map() });
  }
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
  const entry = phaseEntry(s);
  entry.total += 1;
  collectionEntry(entry, collection).roundTrips += 1;
}

/**
 * The phase a command belongs to.
 *
 * Prefers the audit context, which `runPhase` already establishes per phase via
 * AsyncLocalStorage with a `turn:<n>:<phase>` trace id. That follows async
 * boundaries, so a read issued from a continuation inside a phase is still
 * attributed to it — the mutable pointer below cannot do that, and it was why
 * a quarter of all documents landed in "(outside any phase)".
 *
 * Falls back to the pointer for spans bracketed by `withPhaseProfiling`, which
 * are not phases and have no audit context.
 */
function currentPhaseName(s: ProfilerState): string {
  const traceId = getAuditRequestContext()?.traceId;
  if (traceId?.startsWith("turn:")) {
    // "turn:<n>:<phase>" — the phase may itself contain colons, so take the
    // remainder rather than a fixed field.
    const phase = traceId.split(":").slice(2).join(":");
    if (phase) return phase;
  }
  return s.currentPhase ?? "(outside any phase)";
}

function phaseEntry(s: ProfilerState): PhaseCounts {
  const phase = currentPhaseName(s);
  let entry = s.counts.get(phase);
  if (!entry) {
    entry = { total: 0, documents: 0, bytes: 0, byCollection: new Map() };
    s.counts.set(phase, entry);
  }
  return entry;
}

function collectionEntry(entry: PhaseCounts, collection: string) {
  let row = entry.byCollection.get(collection);
  if (!row) {
    row = { roundTrips: 0, documents: 0, bytes: 0 };
    entry.byCollection.set(collection, row);
  }
  return row;
}

/**
 * Documents a command returned, attributed to the open phase. Called from the
 * driver monitor with the size of each result batch.
 */
export function recordDocumentsReturned(collection: string, count: number, bytes = 0): void {
  if (!roundTripProfilingEnabled() || count <= 0) return;
  const entry = phaseEntry(state());
  entry.documents += count;
  entry.bytes += bytes;
  const row = collectionEntry(entry, collection);
  row.documents += count;
  row.bytes += bytes;
}

/**
 * Bracket a span of work that is not a `runPhase` phase, so its reads are
 * attributable instead of landing in "(outside any phase)".
 *
 * Turn setup runs before the first phase and was the single largest bucket in
 * the profile precisely because nothing bracketed it.
 */
export async function withPhaseProfiling<T>(name: string, fn: () => Promise<T>): Promise<T> {
  beginPhaseProfiling(name);
  try {
    return await fn();
  } finally {
    endPhaseProfiling(name);
  }
}

export interface RoundTripPhaseReport {
  phase: string;
  roundTrips: number;
  documents: number;
  bytes: number;
  /** The collections this phase pulls the most bytes from, heaviest first. */
  topCollections: { collection: string; roundTrips: number; documents: number; bytes: number }[];
}

/** Phases by round-trip count, heaviest first. Does not clear the counters. */
export function roundTripReport(topPhases = 20): RoundTripPhaseReport[] {
  return [...state().counts.entries()]
    .map(([phase, entry]) => ({
      phase,
      roundTrips: entry.total,
      documents: entry.documents,
      bytes: entry.bytes,
      topCollections: [...entry.byCollection.entries()]
        .map(([collection, row]) => ({ collection, ...row }))
        .sort(
          (a, b) => b.bytes - a.bytes || b.documents - a.documents || b.roundTrips - a.roundTrips
        )
        .slice(0, 3),
    }))
    .sort((a, b) => b.bytes - a.bytes || b.documents - a.documents || b.roundTrips - a.roundTrips)
    .slice(0, topPhases);
}

export function totalRoundTrips(): number {
  let total = 0;
  for (const entry of state().counts.values()) total += entry.total;
  return total;
}

export function totalDocumentsReturned(): number {
  let total = 0;
  for (const entry of state().counts.values()) total += entry.documents;
  return total;
}

export function totalBytesReturned(): number {
  let total = 0;
  for (const entry of state().counts.values()) total += entry.bytes;
  return total;
}

function formatMb(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1) + "M";
}

/**
 * Render the profile for the turn log. Returns null when profiling is off, so
 * callers can skip the work entirely.
 */
/**
 * Phases to list. The default shows the head of the distribution; set
 * AHD_TURN_ROUNDTRIP_TOP to see the tail, which is where an unattributed
 * bucket hides.
 */
function reportPhaseLimit(fallback: number): number {
  const raw = Number(process.env.AHD_TURN_ROUNDTRIP_TOP);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function formatRoundTripReport(topPhases = 20): string | null {
  if (!roundTripProfilingEnabled()) return null;
  const report = roundTripReport(reportPhaseLimit(topPhases));
  if (report.length === 0) return null;
  const trips = totalRoundTrips();
  const docs = totalDocumentsReturned();
  const bytes = totalBytesReturned();
  const lines = [
    `[roundtrips] ${trips} round trips, ${docs} documents, ${formatMb(bytes)} BSON returned this turn.`,
    `  ranked by bytes (what deserialization costs); documents and round trips alongside:`,
    `  ${"bytes".padStart(8)} ${"share".padStart(6)} ${"docs".padStart(8)} ${"trips".padStart(7)}  phase`,
  ];
  for (const row of report) {
    const share = bytes > 0 ? ((row.bytes / bytes) * 100).toFixed(1) : "0.0";
    const where = row.topCollections
      .map((c) => `${c.collection} ${formatMb(c.bytes)}/${c.documents}d/${c.roundTrips}t`)
      .join(", ");
    lines.push(
      `  ${formatMb(row.bytes).padStart(8)} ${(share + "%").padStart(6)} ${String(row.documents).padStart(8)} ${String(row.roundTrips).padStart(7)}  ${row.phase}  (${where})`
    );
  }
  return lines.join("\n");
}
