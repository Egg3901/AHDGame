import * as v8 from "v8";
import * as Sentry from "@sentry/nextjs";

/*
 * Pre-OOM heap watchdog + leak diagnostics.
 *
 * V8 OOM (`FATAL ERROR: Ineffective mark-compacts near heap limit`) aborts the
 * process via SIGABRT, bypassing JS-level `unhandledRejection` /
 * `uncaughtException` handlers — so `installCrashCapture` in
 * `crashCapture.ts` cannot see it. The 2026-05-24 sandbox-staging incident
 * died this way: V8 OOM during turn 73's NPP behavior phase, container exit
 * with no Sentry signal, only stdout `<--- Last few GCs --->` noise.
 *
 * The watchdog periodically samples `process.memoryUsage().heapUsed` against
 * `v8.getHeapStatistics().heap_size_limit`. Once usage crosses
 * `thresholdPct` (default 75%) — or `rss` crosses `rssThresholdPct` of
 * `rssCapBytes` (default 70% of 5GB) — it fires a Sentry message with
 * rich diagnostics and exits cleanly with code 1 so Railway restarts the
 * container with telemetry intact.
 *
 * Leak-hunt diagnostics included:
 * - Periodic sample log every interval (timeline of heap growth in Railway logs)
 * - Per-turn heap-delta ring buffer (recorded by cron.ts around processTurn)
 * - Per-V8-space stats (which space grows — old_space leak vs large_object_space)
 *
 * NOTE: heap snapshot capture at trip time was REMOVED on 2026-05-25 after
 * two consecutive trips got SIGKILL'd by Railway mid-snapshot.
 * `v8.writeHeapSnapshot()` transiently allocates a buffer equal to heap size
 * while serializing, pushing RSS past the container cap during the dump.
 * The pure `parseHeapSnapshotJson` parser is still exported for future
 * on-demand use (e.g., a separate diagnostic script invoking
 * `v8.writeHeapSnapshot` outside the watchdog trip path), but nothing in the
 * trip handler calls it.
 */

export interface HeapSnapshot {
  heapUsed: number;
  heapSizeLimit: number;
  heapUsedPct: number;
  external: number;
  rss: number;
  /** RSS as a fraction of the configured container memory cap (rssCapBytes). */
  rssPct: number;
  uptimeSec: number;
}

export interface HeapSpaceStat {
  name: string;
  sizeBytes: number;
  usedBytes: number;
  availableBytes: number;
}

export interface TurnHeapDelta {
  turn: number;
  beforeBytes: number;
  afterBytes: number;
  deltaBytes: number;
  durationMs: number;
  at: number;
}

export interface HeapWatchdogDeps {
  intervalMs?: number;
  thresholdPct?: number;
  /**
   * Container memory cap in bytes. Compared against process.memoryUsage().rss
   * to catch the SIGKILL pattern where heap stays under thresholdPct but RSS
   * spikes past the container limit (Railway sandbox: 5GB as of 2026-05-25).
   */
  rssCapBytes?: number;
  rssThresholdPct?: number;
  /**
   * Log a `[heapWatchdog] sample` line only every Nth interval tick. At 10s
   * interval with N=6 we still log every minute but check every 10s — fast
   * detection without log spam.
   */
  sampleLogEveryNTicks?: number;
  onCritical?: (snapshot: HeapSnapshot) => Promise<void> | void;
  /**
   * Releases this process's in-flight turn-processing lock before the trip
   * exits. Injectable for tests; defaults to a lazy import of
   * `releaseLocalProcessingLock` (lazy so this module, which loads very early
   * in instrumentation.ts, does not drag turnSystem's import graph in at boot).
   */
  releaseTurnLock?: (reason: string) => Promise<boolean>;
  process?: NodeJS.Process;
  getMemoryUsage?: () => NodeJS.MemoryUsage;
  getHeapStatistics?: () => { heap_size_limit: number };
  getHeapSpaceStatistics?: () => v8.HeapSpaceInfo[];
  getUptimeSec?: () => number;
  setInterval?: typeof setInterval;
}

const DEFAULT_INTERVAL_MS = 10_000;
// Lowered from 0.85 → 0.75 (and RSS 0.8 → 0.7) on 2026-05-25 after a real trip
// got SIGKILL'd mid-snapshot. The snapshot capture has since been removed
// (see file-level NOTE) but we keep the tighter thresholds — clean restart
// before Railway SIGKILL is still cheaper than a SIGKILL email + cgroup OOM.
const DEFAULT_THRESHOLD_PCT = 0.75;
// Raised from 500MB → 5GB on 2026-05-25 after Railway container cap was bumped.
// Override per service via env (HEAP_WATCHDOG_RSS_CAP_BYTES) if other
// deployments use a different cap.
const DEFAULT_RSS_CAP_BYTES = 5_000_000_000;
const DEFAULT_RSS_THRESHOLD_PCT = 0.7;
const DEFAULT_SAMPLE_LOG_EVERY_N_TICKS = 6; // 10s interval × 6 = sample log per minute.
const SENTRY_FLUSH_MS = 2_000;
// The trip is already an emergency exit; a lock release that cannot complete
// quickly must not delay it. The :30 backup cron's stale takeover remains the
// backstop if this window is missed.
const LOCK_RELEASE_TIMEOUT_MS = 2_000;
const TURN_DELTA_HISTORY_SIZE = 10;
const SNAPSHOT_TOP_CONSTRUCTORS = 25;

// Newest-first ring buffer of per-turn heap deltas, populated by cron.ts.
const turnDeltas: TurnHeapDelta[] = [];

export function recordTurnHeapDelta(args: {
  turn: number;
  beforeBytes: number;
  afterBytes: number;
  durationMs: number;
}): void {
  turnDeltas.unshift({
    turn: args.turn,
    beforeBytes: args.beforeBytes,
    afterBytes: args.afterBytes,
    deltaBytes: args.afterBytes - args.beforeBytes,
    durationMs: args.durationMs,
    at: Date.now(),
  });
  while (turnDeltas.length > TURN_DELTA_HISTORY_SIZE) {
    turnDeltas.pop();
  }
}

export function getRecentTurnDeltas(): TurnHeapDelta[] {
  return turnDeltas.slice();
}

/** Test-only — vitest can clear the ring buffer between tests. */
export function __resetTurnHeapDeltasForTest(): void {
  turnDeltas.length = 0;
}

export function captureHeapSpaceStats(
  deps: Pick<HeapWatchdogDeps, "getHeapSpaceStatistics"> = {}
): HeapSpaceStat[] {
  const getter = deps.getHeapSpaceStatistics ?? (() => v8.getHeapSpaceStatistics());
  return getter().map((s) => ({
    name: s.space_name,
    sizeBytes: s.space_size,
    usedBytes: s.space_used_size,
    availableBytes: s.space_available_size,
  }));
}

/**
 * Walks a parsed `.heapsnapshot` JSON and returns a formatted list of the top
 * N constructors by total self_size. Exposed as a pure function so tests can
 * verify the parsing logic against a hand-crafted fixture without touching
 * the real v8 snapshot machinery.
 */
export function parseHeapSnapshotJson(snap: unknown, maxLines = SNAPSHOT_TOP_CONSTRUCTORS): string {
  try {
    const s = snap as {
      snapshot: { meta: { node_fields: string[]; node_types: string[][] } };
      strings: string[];
      nodes: number[];
    };
    const fields = s.snapshot.meta.node_fields;
    const types = s.snapshot.meta.node_types[0];
    const strings = s.strings;
    const nodes = s.nodes;
    if (!fields || !types || !strings || !nodes) {
      return "(heap snapshot summary unavailable: malformed snapshot)";
    }
    const fc = fields.length;
    const ti = fields.indexOf("type");
    const ni = fields.indexOf("name");
    const si = fields.indexOf("self_size");
    if (ti < 0 || ni < 0 || si < 0) {
      return "(heap snapshot summary unavailable: missing node_fields)";
    }

    const stats = new Map<string, { count: number; bytes: number }>();
    for (let i = 0; i < nodes.length; i += fc) {
      const type = types[nodes[i + ti]] ?? "?";
      const name = strings[nodes[i + ni]] ?? "(anonymous)";
      const bytes = nodes[i + si] ?? 0;
      const key = `${type}/${name}`;
      const existing = stats.get(key);
      if (existing) {
        existing.count++;
        existing.bytes += bytes;
      } else {
        stats.set(key, { count: 1, bytes });
      }
    }

    const top = Array.from(stats.entries())
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .slice(0, maxLines);

    return top
      .map(
        ([key, { count, bytes }]) =>
          `  ${(bytes / 1_000_000).toFixed(2)}MB  ${count.toLocaleString().padStart(8)}  ${key}`
      )
      .join("\n");
  } catch (err) {
    return `(heap snapshot summary unavailable: parse failed — ${err instanceof Error ? err.message : String(err)})`;
  }
}

function snapshotHeap(deps: HeapWatchdogDeps): HeapSnapshot {
  const mem = (deps.getMemoryUsage ?? process.memoryUsage.bind(process))();
  const stats = (deps.getHeapStatistics ?? v8.getHeapStatistics)();
  const uptimeSec = (deps.getUptimeSec ?? process.uptime.bind(process))();
  const heapSizeLimit = stats.heap_size_limit;
  const rssCapBytes = deps.rssCapBytes ?? DEFAULT_RSS_CAP_BYTES;
  return {
    heapUsed: mem.heapUsed,
    heapSizeLimit,
    heapUsedPct: heapSizeLimit > 0 ? mem.heapUsed / heapSizeLimit : 0,
    external: mem.external,
    rss: mem.rss,
    rssPct: rssCapBytes > 0 ? mem.rss / rssCapBytes : 0,
    uptimeSec,
  };
}

function formatMb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(0)}MB`;
}

function logHeapSample(snapshot: HeapSnapshot, spaces: HeapSpaceStat[]): void {
  const pct = (snapshot.heapUsedPct * 100).toFixed(1);
  const oldSpace = spaces.find((s) => s.name === "old_space");
  const oldSpaceBlurb = oldSpace ? ` old_space=${formatMb(oldSpace.usedBytes)}` : "";
  console.log(
    `[heapWatchdog] sample: heap=${formatMb(snapshot.heapUsed)}/${formatMb(snapshot.heapSizeLimit)} (${pct}%) rss=${formatMb(snapshot.rss)} uptime=${(snapshot.uptimeSec / 60).toFixed(1)}min${oldSpaceBlurb}`
  );
}

async function defaultOnCritical(snapshot: HeapSnapshot, deps: HeapWatchdogDeps): Promise<void> {
  const proc = deps.process ?? process;
  const heapPct = snapshot.heapUsedPct;
  const rssPct = snapshot.rssPct;
  const reason = heapPct >= rssPct ? "heap" : "rss";

  // Trip log lands FIRST so it always shows up in Railway logs even if
  // Sentry's transport is the failure mode hanging us. Each line is self-
  // contained so grep + tail works.
  console.error(`[heapWatchdog] TRIP (${reason}) — exiting clean before OOM`, {
    heapUsedMB: Math.round(snapshot.heapUsed / 1_000_000),
    heapLimitMB: Math.round(snapshot.heapSizeLimit / 1_000_000),
    heapPct: Math.round(heapPct * 1000) / 1000,
    rssMB: Math.round(snapshot.rss / 1_000_000),
    rssPct: Math.round(rssPct * 1000) / 1000,
    uptimeSec: Math.round(snapshot.uptimeSec),
  });

  // Snapshot capture intentionally omitted — see file-level NOTE. The light
  // dumps below stay because they are instant console.error calls; they cost
  // no memory allocation worth speaking of.
  const spaces = captureHeapSpaceStats({ getHeapSpaceStatistics: deps.getHeapSpaceStatistics });
  const deltas = getRecentTurnDeltas();
  console.error("[heapWatchdog] heap spaces:", spaces);
  console.error("[heapWatchdog] recent turn deltas:", deltas);

  // Release this process's turn lock BEFORE exiting. A trip that fires mid-turn
  // used to strand gameState.isProcessing with a frozen heartbeat, and since the
  // turn cron only ticks at :00 (plus the :30 backup), the game then sat on
  // "Processing..." until the 20-min stale window elapsed AND one of those ticks
  // came round — up to half an hour of wedge for what is otherwise a clean,
  // deliberate restart. We know we are exiting, so hand the lock back first.
  // Failure here is non-fatal: the stale takeover still backstops it.
  try {
    const releaseTurnLock =
      deps.releaseTurnLock ??
      // `lockReason`, not `reason`: the enclosing scope already has a `reason`
      // ("heap" | "rss") and shadowing it here reads as if the trip reason were
      // being passed straight through, when it is actually the formatted string
      // built at the call site below.
      (async (lockReason: string) => {
        const { releaseLocalProcessingLock } = await import("@/lib/turnSystem");
        return releaseLocalProcessingLock(lockReason);
      });
    // The timer is captured and cleared so the loser of the race does not leave
    // a pending 2s handle behind. Irrelevant in production (we exit immediately
    // after), but with an injected process.exit — i.e. in tests — an uncleared
    // handle keeps the event loop alive past the assertion.
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const released = await Promise.race([
      releaseTurnLock(`heap watchdog trip (${reason})`),
      new Promise<false>((resolve) => {
        releaseTimer = setTimeout(() => resolve(false), LOCK_RELEASE_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (releaseTimer) clearTimeout(releaseTimer);
    });
    console.error(`[heapWatchdog] turn lock release on trip: ${released ? "released" : "no-op"}`);
  } catch (err) {
    console.error("[heapWatchdog] turn lock release on trip failed:", err);
  }

  Sentry.captureMessage("Heap watchdog tripped — exiting before OOM", {
    level: "error",
    tags: { source: "heapWatchdog", reason },
    extra: {
      ...snapshot,
      heapUsedPctRounded: Math.round(heapPct * 1000) / 1000,
      rssPctRounded: Math.round(rssPct * 1000) / 1000,
      heapSpaces: spaces,
      recentTurnDeltas: deltas,
    },
  });

  try {
    await Sentry.flush(SENTRY_FLUSH_MS);
  } catch {
    // Swallow — exit is more important than a delivered Sentry event.
  }
  proc.exit(1);
}

/**
 * Internal tick counter for sample-log throttling. Decoupled from check
 * frequency so a 10s interval can still produce 60s-cadence logs.
 */
let sampleTickCounter = 0;

/** Test-only — reset throttle state between tests. */
export function __resetSampleTickCounterForTest(): void {
  sampleTickCounter = 0;
}

export async function checkHeapAndMaybeTrip(deps: HeapWatchdogDeps = {}): Promise<void> {
  const snapshot = snapshotHeap(deps);
  const heapThresholdPct = deps.thresholdPct ?? DEFAULT_THRESHOLD_PCT;
  const rssThresholdPct = deps.rssThresholdPct ?? DEFAULT_RSS_THRESHOLD_PCT;
  const heapTripped = snapshot.heapUsedPct >= heapThresholdPct;
  const rssTripped = snapshot.rssPct >= rssThresholdPct;
  if (!heapTripped && !rssTripped) {
    const sampleEveryN = deps.sampleLogEveryNTicks ?? DEFAULT_SAMPLE_LOG_EVERY_N_TICKS;
    if (sampleTickCounter % sampleEveryN === 0) {
      const spaces = captureHeapSpaceStats({ getHeapSpaceStatistics: deps.getHeapSpaceStatistics });
      logHeapSample(snapshot, spaces);
    }
    sampleTickCounter++;
    return;
  }
  // Reset so the next post-restart container's logs start fresh at tick 0.
  sampleTickCounter = 0;
  const onCritical = deps.onCritical ?? ((s) => defaultOnCritical(s, deps));
  await onCritical(snapshot);
}

export function startHeapWatchdog(deps: HeapWatchdogDeps = {}): NodeJS.Timeout {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const schedule = deps.setInterval ?? setInterval;
  const handle = schedule(() => {
    // Catch in the wrapper so a watchdog-internal failure stays tagged as a
    // watchdog problem instead of leaking as an unhandledRejection (which
    // crashCapture would catch and exit, but with the wrong source tag and
    // without the heap snapshot context).
    checkHeapAndMaybeTrip(deps).catch((err) => {
      console.error("[heapWatchdog] check failed:", err);
    });
  }, intervalMs);
  // node-cron and Next.js dev refresh can re-import; the timer is intentionally
  // unref'd so it never holds the event loop open in tests/dev.
  if (typeof (handle as NodeJS.Timeout).unref === "function") {
    (handle as NodeJS.Timeout).unref();
  }
  return handle as NodeJS.Timeout;
}
