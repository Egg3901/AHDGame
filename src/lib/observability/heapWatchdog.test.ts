import { describe, it, expect, vi, beforeEach } from "vitest";

// startHeapWatchdog must fire a Sentry event and exit the process *before* V8
// OOM aborts via SIGABRT, so we get telemetry on memory pressure. The 2026-05-24
// sandbox crash dumped a "FATAL ERROR: Ineffective mark-compacts" stack to
// stdout only — Sentry's crashCapture can't catch SIGABRT, so without a
// pre-OOM watchdog we have zero observability into the leak.

const captureMessage = vi.fn();
const flush = vi.fn().mockResolvedValue(true);
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
  flush: (...args: unknown[]) => flush(...args),
}));

describe("checkHeapAndMaybeTrip", () => {
  beforeEach(() => {
    captureMessage.mockReset();
    flush.mockReset();
    flush.mockResolvedValue(true);
  });

  it("does nothing when heap usage is below the threshold", async () => {
    const onCritical = vi.fn();
    const { checkHeapAndMaybeTrip } = await import("./heapWatchdog");

    await checkHeapAndMaybeTrip({
      thresholdPct: 0.85,
      onCritical,
      getMemoryUsage: () => ({
        heapUsed: 100_000_000,
        heapTotal: 150_000_000,
        external: 5_000_000,
        rss: 200_000_000,
        arrayBuffers: 1_000_000,
      }),
      getHeapStatistics: () => ({ heap_size_limit: 500_000_000 }),
      getUptimeSec: () => 60,
    });

    expect(onCritical).not.toHaveBeenCalled();
  });

  it("invokes onCritical with a populated snapshot when heap usage crosses the threshold", async () => {
    const onCritical = vi.fn();
    const { checkHeapAndMaybeTrip } = await import("./heapWatchdog");

    await checkHeapAndMaybeTrip({
      thresholdPct: 0.85,
      onCritical,
      getMemoryUsage: () => ({
        heapUsed: 220_000_000,
        heapTotal: 240_000_000,
        external: 7_000_000,
        rss: 320_000_000,
        arrayBuffers: 2_000_000,
      }),
      getHeapStatistics: () => ({ heap_size_limit: 256_000_000 }),
      getUptimeSec: () => 52_000,
    });

    expect(onCritical).toHaveBeenCalledTimes(1);
    const snapshot = onCritical.mock.calls[0][0];
    expect(snapshot.heapUsed).toBe(220_000_000);
    expect(snapshot.heapSizeLimit).toBe(256_000_000);
    expect(snapshot.heapUsedPct).toBeCloseTo(220 / 256, 3);
    expect(snapshot.external).toBe(7_000_000);
    expect(snapshot.rss).toBe(320_000_000);
    expect(snapshot.uptimeSec).toBe(52_000);
  });

  it("default onCritical captures a Sentry message, flushes, and exits 1", async () => {
    const exit = vi.fn();
    const fakeProc = { exit } as unknown as NodeJS.Process;
    const { checkHeapAndMaybeTrip } = await import("./heapWatchdog");

    await checkHeapAndMaybeTrip({
      thresholdPct: 0.85,
      process: fakeProc,
      getMemoryUsage: () => ({
        heapUsed: 230_000_000,
        heapTotal: 240_000_000,
        external: 0,
        rss: 0,
        arrayBuffers: 0,
      }),
      getHeapStatistics: () => ({ heap_size_limit: 256_000_000 }),
      getUptimeSec: () => 1,
    });

    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("Heap watchdog"),
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({ source: "heapWatchdog" }),
        extra: expect.objectContaining({
          heapUsed: 230_000_000,
          heapSizeLimit: 256_000_000,
        }),
      })
    );
    expect(flush).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("default onCritical still exits when Sentry flush rejects", async () => {
    flush.mockRejectedValueOnce(new Error("sentry down"));
    const exit = vi.fn();
    const fakeProc = { exit } as unknown as NodeJS.Process;
    const { checkHeapAndMaybeTrip } = await import("./heapWatchdog");

    await checkHeapAndMaybeTrip({
      thresholdPct: 0.85,
      process: fakeProc,
      getMemoryUsage: () => ({
        heapUsed: 250_000_000,
        heapTotal: 260_000_000,
        external: 0,
        rss: 0,
        arrayBuffers: 0,
      }),
      getHeapStatistics: () => ({ heap_size_limit: 256_000_000 }),
      getUptimeSec: () => 1,
    });

    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("RSS-based trip threshold", () => {
  // Why: Railway SIGKILLs the container when RSS > container memory cap.
  // The previous heap-only watchdog never tripped on the 2026-05-25 deaths
  // because peak heap was ~85% but RSS spiked past 500MB during/after turn
  // processing. This test set ensures the watchdog also catches RSS spikes.

  beforeEach(() => {
    captureMessage.mockReset();
    flush.mockReset();
    flush.mockResolvedValue(true);
  });

  it("trips on RSS even when heap is below the heap threshold", async () => {
    const onCritical = vi.fn();
    const { checkHeapAndMaybeTrip } = await import("./heapWatchdog");

    await checkHeapAndMaybeTrip({
      thresholdPct: 0.85,
      rssCapBytes: 500_000_000,
      rssThresholdPct: 0.8,
      onCritical,
      getMemoryUsage: () => ({
        heapUsed: 150_000_000, // 30% of 500MB heap limit — fine
        heapTotal: 200_000_000,
        external: 0,
        rss: 420_000_000, // 84% of 500MB RSS cap — TRIPS
        arrayBuffers: 0,
      }),
      getHeapStatistics: () => ({ heap_size_limit: 500_000_000 }),
      getUptimeSec: () => 100,
    });

    expect(onCritical).toHaveBeenCalledTimes(1);
    const snap = onCritical.mock.calls[0][0];
    expect(snap.rssPct).toBeCloseTo(420 / 500, 3);
  });

  it("trips on heap even when RSS is well below the RSS threshold", async () => {
    const onCritical = vi.fn();
    const { checkHeapAndMaybeTrip } = await import("./heapWatchdog");

    await checkHeapAndMaybeTrip({
      thresholdPct: 0.85,
      rssCapBytes: 500_000_000,
      rssThresholdPct: 0.8,
      onCritical,
      getMemoryUsage: () => ({
        heapUsed: 230_000_000, // 90% of 256MB heap limit — TRIPS
        heapTotal: 250_000_000,
        external: 0,
        rss: 300_000_000, // 60% of 500MB — fine
        arrayBuffers: 0,
      }),
      getHeapStatistics: () => ({ heap_size_limit: 256_000_000 }),
      getUptimeSec: () => 100,
    });

    expect(onCritical).toHaveBeenCalledTimes(1);
  });

  it("does NOT trip when both heap and RSS are below thresholds", async () => {
    const onCritical = vi.fn();
    const { checkHeapAndMaybeTrip } = await import("./heapWatchdog");

    await checkHeapAndMaybeTrip({
      thresholdPct: 0.85,
      rssCapBytes: 500_000_000,
      rssThresholdPct: 0.8,
      onCritical,
      getMemoryUsage: () => ({
        heapUsed: 200_000_000, // ~78% — fine
        heapTotal: 240_000_000,
        external: 0,
        rss: 380_000_000, // 76% — fine
        arrayBuffers: 0,
      }),
      getHeapStatistics: () => ({ heap_size_limit: 256_000_000 }),
      getUptimeSec: () => 100,
    });

    expect(onCritical).not.toHaveBeenCalled();
  });

  it("does NOT call v8.writeHeapSnapshot at trip time (Railway SIGKILL'd it mid-dump on 2026-05-25)", async () => {
    // The 2026-05-25 trips got SIGKILL'd by Railway during writeHeapSnapshot
    // because the snapshot transiently ~2x peak memory while serializing. Two
    // consecutive containers tripped, dumped TRIP + space stats + deltas, then
    // died before topConstructors finished writing. We removed the snapshot
    // entirely — keep RSS/heap thresholds + light dumps. Constructor data
    // comes from a heap profiler invoked manually, not from the watchdog.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { checkHeapAndMaybeTrip } = await import("./heapWatchdog");
    await checkHeapAndMaybeTrip({
      thresholdPct: 0.5,
      process: { exit: vi.fn() } as unknown as NodeJS.Process,
      getMemoryUsage: () => ({
        heapUsed: 90,
        heapTotal: 100,
        external: 0,
        rss: 0,
        arrayBuffers: 0,
      }),
      getHeapStatistics: () => ({ heap_size_limit: 100 }),
      getUptimeSec: () => 1,
    });
    const topConstructorsCall = consoleErrorSpy.mock.calls.find((args) =>
      args.some((a) => typeof a === "string" && a.includes("top constructors"))
    );
    expect(topConstructorsCall).toBeUndefined();
    consoleErrorSpy.mockRestore();
  });

  it("emits the TRIP log line to stderr BEFORE invoking Sentry.captureMessage", async () => {
    // If Sentry's transport is what's broken, we still need the trip recorded
    // in Railway logs. captureMessage is async send (non-blocking) but flush
    // can hang; either way, stderr should win the race.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let captureMessageCalledAt = -1;
    let firstStderrTripAt = -1;
    let counter = 0;
    captureMessage.mockImplementation(() => {
      captureMessageCalledAt = ++counter;
    });
    consoleErrorSpy.mockImplementation((...args: unknown[]) => {
      if (firstStderrTripAt < 0 && args.some((a) => typeof a === "string" && a.includes("TRIP"))) {
        firstStderrTripAt = ++counter;
      }
    });
    const exit = vi.fn();

    const { checkHeapAndMaybeTrip } = await import("./heapWatchdog");
    await checkHeapAndMaybeTrip({
      thresholdPct: 0.5,
      process: { exit } as unknown as NodeJS.Process,
      getMemoryUsage: () => ({
        heapUsed: 90,
        heapTotal: 100,
        external: 0,
        rss: 0,
        arrayBuffers: 0,
      }),
      getHeapStatistics: () => ({ heap_size_limit: 100 }),
      getUptimeSec: () => 1,
    });

    expect(firstStderrTripAt).toBeGreaterThan(0);
    expect(captureMessageCalledAt).toBeGreaterThan(0);
    expect(firstStderrTripAt).toBeLessThan(captureMessageCalledAt);
    consoleErrorSpy.mockRestore();
  });
});

describe("recordTurnHeapDelta + getRecentTurnDeltas", () => {
  it("records turn deltas in newest-first order and caps history at the ring-buffer size", async () => {
    const mod = await import("./heapWatchdog");
    mod.__resetTurnHeapDeltasForTest();

    for (let i = 1; i <= 12; i++) {
      mod.recordTurnHeapDelta({
        turn: i,
        beforeBytes: 100_000_000 + i * 1_000_000,
        afterBytes: 100_000_000 + i * 1_000_000 + 5_000_000,
        durationMs: 1000,
      });
    }

    const recent = mod.getRecentTurnDeltas();
    // Default ring-buffer holds the 10 most recent entries.
    expect(recent).toHaveLength(10);
    // Newest first: turn 12, 11, 10, ... 3.
    expect(recent[0].turn).toBe(12);
    expect(recent[recent.length - 1].turn).toBe(3);
    expect(recent[0].deltaBytes).toBe(5_000_000);
  });
});

describe("parseHeapSnapshotJson", () => {
  it("returns top constructors sorted by total self_size descending", async () => {
    const { parseHeapSnapshotJson } = await import("./heapWatchdog");

    // Minimal viable heap-snapshot shape:
    //   meta.node_fields = ["type","name","self_size"]
    //   meta.node_types[0] = ["hidden","object","closure","string"]
    //   strings index 0 = "(empty)", 1 = "PoliticalParty", 2 = "TurnContext", 3 = "Buffer"
    //   nodes = flat array, 3 ints per node.
    const fakeSnap = {
      snapshot: {
        meta: {
          node_fields: ["type", "name", "self_size"],
          node_types: [["hidden", "object", "closure", "string"]],
        },
      },
      strings: ["(empty)", "PoliticalParty", "TurnContext", "Buffer"],
      // 4 nodes:
      //   object PoliticalParty 100 bytes
      //   object PoliticalParty 200 bytes
      //   closure TurnContext 50 bytes
      //   string Buffer 9999 bytes
      nodes: [1, 1, 100, 1, 1, 200, 2, 2, 50, 3, 3, 9999],
    };

    const summary = parseHeapSnapshotJson(fakeSnap, 5);
    // Buffer dominates (9999) > PoliticalParty (300) > TurnContext (50).
    const lines = summary.split("\n");
    expect(lines[0]).toContain("string/Buffer");
    expect(lines[1]).toContain("object/PoliticalParty");
    expect(lines[1]).toContain("2"); // count
    expect(lines[2]).toContain("closure/TurnContext");
  });

  it("does not throw when the snapshot is malformed — returns an error string", async () => {
    const { parseHeapSnapshotJson } = await import("./heapWatchdog");
    const summary = parseHeapSnapshotJson({} as never, 5);
    expect(summary).toMatch(/unavailable|parse failed|malformed/i);
  });
});

describe("captureHeapSpaceStats", () => {
  it("returns a per-space breakdown via injected getter", async () => {
    const { captureHeapSpaceStats } = await import("./heapWatchdog");
    const stats = captureHeapSpaceStats({
      getHeapSpaceStatistics: () => [
        {
          space_name: "old_space",
          space_size: 200_000_000,
          space_used_size: 180_000_000,
          space_available_size: 20_000_000,
          physical_space_size: 200_000_000,
        },
        {
          space_name: "new_space",
          space_size: 8_000_000,
          space_used_size: 5_000_000,
          space_available_size: 3_000_000,
          physical_space_size: 8_000_000,
        },
      ],
    });
    expect(stats).toHaveLength(2);
    expect(stats[0].name).toBe("old_space");
    expect(stats[0].usedBytes).toBe(180_000_000);
  });
});

describe("default onCritical enrichment", () => {
  it("includes heap spaces and recent turn deltas in the Sentry event extras", async () => {
    const mod = await import("./heapWatchdog");
    mod.__resetTurnHeapDeltasForTest();
    mod.recordTurnHeapDelta({ turn: 1, beforeBytes: 10, afterBytes: 20, durationMs: 100 });

    const exit = vi.fn();
    await mod.checkHeapAndMaybeTrip({
      thresholdPct: 0.5,
      process: { exit } as unknown as NodeJS.Process,
      getMemoryUsage: () => ({
        heapUsed: 60,
        heapTotal: 100,
        external: 0,
        rss: 0,
        arrayBuffers: 0,
      }),
      getHeapStatistics: () => ({ heap_size_limit: 100 }),
      getUptimeSec: () => 1,
      getHeapSpaceStatistics: () => [
        {
          space_name: "old_space",
          space_size: 80,
          space_used_size: 60,
          space_available_size: 20,
          physical_space_size: 80,
        },
      ],
    });

    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("Heap watchdog"),
      expect.objectContaining({
        extra: expect.objectContaining({
          heapSpaces: expect.any(Array),
          recentTurnDeltas: expect.any(Array),
        }),
      })
    );
    // topConstructors is intentionally absent — writeHeapSnapshot would
    // transiently 2x the heap and get SIGKILL'd by Railway before the trip
    // can complete. See 2026-05-25 incident.
    const extra = captureMessage.mock.calls[0][1].extra;
    expect(extra).not.toHaveProperty("topConstructors");
  });
});

describe("startHeapWatchdog", () => {
  it("catches errors in the interval callback so a watchdog failure can't leak as an unhandledRejection", async () => {
    // If checkHeapAndMaybeTrip (or its onCritical) throws, the void-promise
    // pattern would surface as an unhandledRejection — picked up by
    // crashCapture and exiting the process with `source: unhandledRejection`
    // tagging instead of `source: heapWatchdog`. Catch in the wrapper so the
    // failure stays observable as a heap-watchdog problem.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onCriticalThatThrows = vi.fn().mockRejectedValue(new Error("sentry blew up"));
    let capturedFn: (() => unknown) | null = null;
    const fakeSetInterval = ((fn: () => unknown) => {
      capturedFn = fn;
      return Symbol("handle") as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval;

    const { startHeapWatchdog } = await import("./heapWatchdog");

    startHeapWatchdog({
      thresholdPct: 0.5,
      onCritical: onCriticalThatThrows,
      setInterval: fakeSetInterval,
      getMemoryUsage: () => ({
        heapUsed: 100,
        heapTotal: 100,
        external: 0,
        rss: 0,
        arrayBuffers: 0,
      }),
      getHeapStatistics: () => ({ heap_size_limit: 100 }),
      getUptimeSec: () => 1,
    });

    expect(capturedFn).not.toBeNull();
    capturedFn!();
    // Let the rejected promise settle through the catch wrapper.
    await new Promise((resolve) => setImmediate(resolve));

    expect(onCriticalThatThrows).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[heapWatchdog]"),
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it("logs a periodic heap sample line each tick even when the threshold is not crossed", async () => {
    // Continuous timeline in Railway logs lets us see growth velocity without
    // waiting for the trip — essential for the leak hunt.
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let capturedFn: (() => unknown) | null = null;
    const fakeSetInterval = ((fn: () => unknown) => {
      capturedFn = fn;
      return Symbol("h") as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval;

    const { startHeapWatchdog } = await import("./heapWatchdog");
    startHeapWatchdog({
      thresholdPct: 0.85,
      setInterval: fakeSetInterval,
      // Below threshold — should sample, not trip.
      getMemoryUsage: () => ({
        heapUsed: 50_000_000,
        heapTotal: 100_000_000,
        external: 0,
        rss: 75_000_000,
        arrayBuffers: 0,
      }),
      getHeapStatistics: () => ({ heap_size_limit: 200_000_000 }),
      getUptimeSec: () => 120,
    });

    expect(capturedFn).not.toBeNull();
    capturedFn!();
    await new Promise((resolve) => setImmediate(resolve));

    const sampleLogs = consoleLogSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === "string" && a.includes("[heapWatchdog] sample"))
    );
    expect(sampleLogs.length).toBeGreaterThan(0);

    consoleLogSpy.mockRestore();
  });

  it("throttles the sample log so a faster interval (10s checks) still only logs every N ticks", async () => {
    // We want fast detection (10s) but readable logs (sample every Nth tick).
    // Decoupling check frequency from log frequency keeps Railway log volume
    // sane while making the watchdog responsive to RSS spikes that resolve
    // between 60-second windows.
    const mod = await import("./heapWatchdog");
    mod.__resetSampleTickCounterForTest();
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let capturedFn: (() => unknown) | null = null;
    const fakeSetInterval = ((fn: () => unknown) => {
      capturedFn = fn;
      return Symbol("h") as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval;

    const { startHeapWatchdog } = mod;
    startHeapWatchdog({
      thresholdPct: 0.85,
      sampleLogEveryNTicks: 3,
      setInterval: fakeSetInterval,
      getMemoryUsage: () => ({
        heapUsed: 50_000_000,
        heapTotal: 100_000_000,
        external: 0,
        rss: 75_000_000,
        arrayBuffers: 0,
      }),
      getHeapStatistics: () => ({ heap_size_limit: 200_000_000 }),
      getUptimeSec: () => 120,
    });

    // Fire 6 ticks: only ticks 1 and 4 should log (every Nth).
    for (let i = 0; i < 6; i++) {
      capturedFn!();
      await new Promise((r) => setImmediate(r));
    }
    const sampleLogs = consoleLogSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === "string" && a.includes("[heapWatchdog] sample"))
    );
    expect(sampleLogs).toHaveLength(2);

    consoleLogSpy.mockRestore();
  });

  it("schedules the heap check at the given interval and returns the timer handle", async () => {
    const handle = Symbol("timer-handle");
    const scheduled: { fn: () => unknown; ms: number }[] = [];
    const fakeSetInterval = ((fn: () => unknown, ms: number) => {
      scheduled.push({ fn, ms });
      return handle as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval;

    const { startHeapWatchdog } = await import("./heapWatchdog");

    const returned = startHeapWatchdog({
      intervalMs: 30_000,
      setInterval: fakeSetInterval,
      getMemoryUsage: () => ({
        heapUsed: 1,
        heapTotal: 1,
        external: 0,
        rss: 0,
        arrayBuffers: 0,
      }),
      getHeapStatistics: () => ({ heap_size_limit: 1_000_000 }),
    });

    expect(returned).toBe(handle);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBe(30_000);
  });
});
