import { Session } from "node:inspector/promises";

/*
 * V8 sampling heap-profiler wrapper. Drives `HeapProfiler.startSampling` /
 * `stopSampling` via the built-in `node:inspector` module to capture a
 * function-level allocation profile — each node carries the call frame
 * (functionName + url:line) and `selfSize` (bytes allocated by THIS frame
 * that are still alive at sample-stop time).
 *
 * Use this for one-shot leak diagnosis: start sampling at heap baseline,
 * wait until enough creep has accumulated (multiple turn cycles, hours of
 * background activity), stop, look at the top-N nodes by selfSize. The
 * function names + source lines are direct pointers to the leak source.
 *
 * V8 samples every Nth byte of allocation (default 32 KB here). Smaller
 * intervals = more accurate but more sample-collection overhead. 32 KB is
 * fine-grained enough to identify the inter-turn ~1 MB/min creep we are
 * chasing on `fix/timer-issue`.
 */

// V8 HeapProfiler.SamplingHeapProfileNode shape. Defined here instead of
// pulling from `inspector` types because the official types don't always
// expose the full tree; we only need the fields the formatter touches.
export interface SamplingHeapProfileNode {
  callFrame: {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  selfSize: number;
  id: number;
  children: SamplingHeapProfileNode[];
}

export interface SamplingHeapProfile {
  head: SamplingHeapProfileNode;
  samples?: unknown[];
}

export interface FlattenedAllocationNode {
  functionName: string;
  url: string;
  lineNumber: number;
  selfSize: number;
  callPath: string[];
}

export const DEFAULT_SAMPLING_INTERVAL_BYTES = 32 * 1024;
export const DEFAULT_PROFILE_TOP_N = 25;

/**
 * Walks the V8 SamplingHeapProfile tree and flattens it into an array of
 * nodes, preserving the call path from root to each node. The root node
 * (functionName "(root)" with empty url) is included; the formatter strips
 * it. Exposed as a pure function so tests can verify the walk against a
 * hand-crafted fixture without spinning up an inspector session.
 */
export function flattenAllocationProfile(profile: SamplingHeapProfile): FlattenedAllocationNode[] {
  const out: FlattenedAllocationNode[] = [];

  function walk(node: SamplingHeapProfileNode, ancestors: string[]): void {
    const path = [...ancestors, node.callFrame.functionName || "(anonymous)"];
    out.push({
      functionName: node.callFrame.functionName || "(anonymous)",
      url: node.callFrame.url,
      lineNumber: node.callFrame.lineNumber,
      selfSize: node.selfSize,
      callPath: path,
    });
    for (const child of node.children) {
      walk(child, path);
    }
  }

  if (!profile?.head) return out;
  walk(profile.head, []);
  return out;
}

/**
 * Render the top-N allocators from a sampling profile as a multi-line
 * string. Each line:
 *   "  <X.XX>MB  <functionName>  <url>:<lineNumber>"
 * Sorted by selfSize desc. Root + same-as-root synthetic nodes are filtered
 * out so the report focuses on user code + library frames.
 */
export function formatAllocationProfile(
  profile: SamplingHeapProfile,
  maxLines: number = DEFAULT_PROFILE_TOP_N
): string {
  try {
    const flat = flattenAllocationProfile(profile);
    if (flat.length === 0) {
      return "(allocation profile unavailable: malformed or empty profile)";
    }
    const filtered = flat.filter((n) => n.functionName !== "(root)" && n.selfSize > 0);
    filtered.sort((a, b) => b.selfSize - a.selfSize);
    const top = filtered.slice(0, maxLines);
    return top
      .map((n) => {
        const sizeMb = (n.selfSize / 1_000_000).toFixed(2);
        const location = n.url ? `${n.url}:${n.lineNumber}` : "(no source)";
        return `  ${sizeMb.padStart(7)}MB  ${n.functionName.padEnd(40)}  ${location}`;
      })
      .join("\n");
  } catch (err) {
    return `(allocation profile unavailable: format failed — ${err instanceof Error ? err.message : String(err)})`;
  }
}

export interface CaptureAllocationProfileOptions {
  /** Sampling duration in ms. Longer = more accurate, but the calling HTTP
   * request blocks this long. Default 5 min. */
  durationMs?: number;
  /** Bytes between samples (V8). Default 32 KB; lower = finer-grained. */
  samplingIntervalBytes?: number;
  /** Test seam: skip the real inspector session and use this fake profile. */
  fakeProfile?: SamplingHeapProfile;
  /** Test seam: skip the real setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/** Single in-process flag — V8's HeapProfiler.startSampling is global, so
 * concurrent captures would corrupt each other's state. The HTTP route uses
 * this to fail-fast with 409 instead of producing garbled output. */
let captureInProgress = false;

export class AllocationProfileBusyError extends Error {
  constructor() {
    super("Allocation profile capture already in progress");
    this.name = "AllocationProfileBusyError";
  }
}

export function isAllocationProfileCaptureInProgress(): boolean {
  // Either the synchronous V8 inspector flag is set, or a background capture
  // was just queued via startAllocationProfileInBackground and hasn't yet
  // entered the inspector loop. Both states block new captures.
  return captureInProgress || currentCaptureStartedAt !== null;
}

/**
 * Async background-capture state machine. The synchronous
 * `captureAllocationProfile` blocks for `durationMs`, which exceeds
 * Cloudflare's 100s proxy timeout for any meaningful sample window. The HTTP
 * route uses this state machine to kick off the capture in the background
 * and respond immediately; a follow-up GET retrieves the result.
 */
export interface AllocationProfileResult {
  profile: SamplingHeapProfile;
  startedAt: string;
  stoppedAt: string;
  durationMs: number;
  samplingIntervalBytes: number;
}

export interface AllocationProfileError {
  message: string;
  at: string;
}

let lastResult: AllocationProfileResult | null = null;
let lastError: AllocationProfileError | null = null;
let currentCaptureStartedAt: string | null = null;
let currentCaptureDurationMs: number | null = null;

export function getLastAllocationProfileResult(): AllocationProfileResult | null {
  return lastResult;
}

export function getLastAllocationProfileError(): AllocationProfileError | null {
  return lastError;
}

/** Returns timestamps when a capture is in progress; null otherwise. */
export function getCurrentCaptureState(): {
  startedAt: string;
  durationMs: number;
  estimatedFinishAt: string;
} | null {
  if (!captureInProgress || !currentCaptureStartedAt || !currentCaptureDurationMs) return null;
  const startMs = new Date(currentCaptureStartedAt).getTime();
  return {
    startedAt: currentCaptureStartedAt,
    durationMs: currentCaptureDurationMs,
    estimatedFinishAt: new Date(startMs + currentCaptureDurationMs).toISOString(),
  };
}

/**
 * Fire-and-forget start of an allocation-profile capture. Returns immediately
 * with the start timestamps; the capture runs in the background. Use
 * `getLastAllocationProfileResult` / `getLastAllocationProfileError` to
 * retrieve the outcome once `getCurrentCaptureState()` returns null again.
 *
 * The internal promise is intentionally unawaited — the caller HTTP request
 * needs to return before Cloudflare's 100s timeout. The runtime catches
 * rejections via the finally block in `captureAllocationProfile`, so this
 * does not leak unhandled rejections.
 */
export function startAllocationProfileInBackground(opts: CaptureAllocationProfileOptions = {}): {
  startedAt: string;
  durationMs: number;
  samplingIntervalBytes: number;
  estimatedFinishAt: string;
} {
  if (isAllocationProfileCaptureInProgress()) {
    throw new AllocationProfileBusyError();
  }
  const durationMs = opts.durationMs ?? 5 * 60 * 1000;
  const samplingIntervalBytes = opts.samplingIntervalBytes ?? DEFAULT_SAMPLING_INTERVAL_BYTES;
  const startedAt = new Date().toISOString();
  // Mark in-progress SYNCHRONOUSLY (before returning) so a concurrent POST
  // immediately after sees a populated currentCaptureStartedAt and is
  // rejected. The async work below sets+clears captureInProgress itself via
  // captureAllocationProfile. We only own currentCaptureStartedAt /
  // currentCaptureDurationMs here.
  currentCaptureStartedAt = startedAt;
  currentCaptureDurationMs = durationMs;
  void (async () => {
    try {
      const profile = await captureAllocationProfile({
        ...opts,
        durationMs,
        samplingIntervalBytes,
      });
      lastResult = {
        profile,
        startedAt,
        stoppedAt: new Date().toISOString(),
        durationMs,
        samplingIntervalBytes,
      };
      lastError = null;
    } catch (err) {
      lastError = {
        message: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      };
    } finally {
      currentCaptureStartedAt = null;
      currentCaptureDurationMs = null;
    }
  })();
  return {
    startedAt,
    durationMs,
    samplingIntervalBytes,
    estimatedFinishAt: new Date(Date.now() + durationMs).toISOString(),
  };
}

/** Test-only — reset state between tests. */
export function __resetAllocationProfileBusyForTest(): void {
  captureInProgress = false;
  lastResult = null;
  lastError = null;
  currentCaptureStartedAt = null;
  currentCaptureDurationMs = null;
}

/**
 * Run a V8 sampling heap-profiler for `durationMs`, then stop and return the
 * raw profile tree. The caller is responsible for formatting (see
 * `formatAllocationProfile`).
 *
 * Live profiling runs in V8 — about 5% CPU at the default sampling interval.
 * Memory overhead is small (a few MB of sample metadata per minute).
 */
/** Hard deadline on individual inspector calls so a hung V8 inspector
 * (observed 2026-05-26: HeapProfiler.startSampling never resolved on
 * sandbox) does not lock the capture state forever. The session is still
 * disconnected in the outer finally even if the post() promise we await
 * here loses the race against this timeout. */
const INSPECTOR_CALL_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export async function captureAllocationProfile(
  opts: CaptureAllocationProfileOptions = {}
): Promise<SamplingHeapProfile> {
  if (captureInProgress) {
    throw new AllocationProfileBusyError();
  }
  captureInProgress = true;
  try {
    if (opts.fakeProfile) {
      // Test path: still honor the sleep so tests can assert duration handling
      // if they want, but skip the real inspector session.
      const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
      if (opts.durationMs && opts.durationMs > 0) await sleep(opts.durationMs);
      return opts.fakeProfile;
    }

    const durationMs = opts.durationMs ?? 5 * 60 * 1000;
    const samplingIntervalBytes = opts.samplingIntervalBytes ?? DEFAULT_SAMPLING_INTERVAL_BYTES;
    const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

    console.log(
      `[allocProfile] start durationMs=${durationMs} samplingIntervalBytes=${samplingIntervalBytes}`
    );
    const session = new Session();
    session.connect();
    console.log("[allocProfile] session connected");
    try {
      await withTimeout(
        session.post("HeapProfiler.startSampling", {
          samplingInterval: samplingIntervalBytes,
        }),
        INSPECTOR_CALL_TIMEOUT_MS,
        "HeapProfiler.startSampling"
      );
      console.log("[allocProfile] startSampling ack");
      await sleep(durationMs);
      console.log("[allocProfile] sleep done, calling stopSampling");
      const result = (await withTimeout(
        session.post("HeapProfiler.stopSampling"),
        INSPECTOR_CALL_TIMEOUT_MS,
        "HeapProfiler.stopSampling"
      )) as { profile: SamplingHeapProfile };
      const profileBytes = JSON.stringify(result.profile).length;
      console.log(`[allocProfile] stopSampling ack, profileBytes=${profileBytes}`);
      return result.profile;
    } finally {
      try {
        session.disconnect();
        console.log("[allocProfile] session disconnected");
      } catch (err) {
        console.warn(
          "[allocProfile] session.disconnect threw:",
          err instanceof Error ? err.message : err
        );
      }
    }
  } finally {
    captureInProgress = false;
  }
}
