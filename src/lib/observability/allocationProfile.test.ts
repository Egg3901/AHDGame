import { describe, it, expect, beforeEach } from "vitest";
import {
  flattenAllocationProfile,
  formatAllocationProfile,
  captureAllocationProfile,
  startAllocationProfileInBackground,
  getLastAllocationProfileResult,
  getLastAllocationProfileError,
  getCurrentCaptureState,
  isAllocationProfileCaptureInProgress,
  AllocationProfileBusyError,
  __resetAllocationProfileBusyForTest,
  type SamplingHeapProfile,
} from "./allocationProfile";

// Fixture mirroring V8's HeapProfiler.stopSampling shape — a tree where each
// node carries `callFrame` + `selfSize` and recursively contains `children`.
// We only need the shape the formatter cares about; samples[] and id are
// ignored by the formatter and omitted here.
const fixture: SamplingHeapProfile = {
  head: {
    callFrame: {
      functionName: "(root)",
      scriptId: "0",
      url: "",
      lineNumber: -1,
      columnNumber: -1,
    },
    selfSize: 0,
    id: 1,
    children: [
      {
        callFrame: {
          functionName: "processTurn",
          scriptId: "1",
          url: "src/lib/turnSystem.ts",
          lineNumber: 91,
          columnNumber: 0,
        },
        selfSize: 1_000_000,
        id: 2,
        children: [
          {
            callFrame: {
              functionName: "loadNPPContext",
              scriptId: "2",
              url: "src/lib/turn/npp/context.ts",
              lineNumber: 17,
              columnNumber: 0,
            },
            selfSize: 8_000_000,
            id: 3,
            children: [],
          },
        ],
      },
      {
        callFrame: {
          functionName: "captureEvent",
          scriptId: "3",
          url: "node_modules/@sentry/core/dist/hub.js",
          lineNumber: 100,
          columnNumber: 0,
        },
        selfSize: 5_500_000,
        id: 4,
        children: [],
      },
    ],
  },
};

describe("flattenAllocationProfile", () => {
  it("flattens the call-tree into nodes with full call paths", () => {
    const nodes = flattenAllocationProfile(fixture);
    // root + 3 functions
    expect(nodes).toHaveLength(4);

    const loadNPP = nodes.find((n) => n.functionName === "loadNPPContext");
    expect(loadNPP).toBeDefined();
    expect(loadNPP!.selfSize).toBe(8_000_000);
    // Full path includes all ancestors
    expect(loadNPP!.callPath).toEqual(["(root)", "processTurn", "loadNPPContext"]);
  });

  it("preserves url + line per node for source-pointing in the report", () => {
    const nodes = flattenAllocationProfile(fixture);
    const loadNPP = nodes.find((n) => n.functionName === "loadNPPContext")!;
    expect(loadNPP.url).toBe("src/lib/turn/npp/context.ts");
    expect(loadNPP.lineNumber).toBe(17);
  });
});

describe("formatAllocationProfile", () => {
  it("sorts top N by selfSize descending and renders function:url:line per line", () => {
    const summary = formatAllocationProfile(fixture, 3);
    const lines = summary.split("\n").filter(Boolean);

    // Top is loadNPPContext (8MB), then captureEvent (5.5MB), then processTurn (1MB)
    expect(lines[0]).toContain("8.00MB");
    expect(lines[0]).toContain("loadNPPContext");
    expect(lines[0]).toContain("src/lib/turn/npp/context.ts:17");

    expect(lines[1]).toContain("5.50MB");
    expect(lines[1]).toContain("captureEvent");

    expect(lines[2]).toContain("1.00MB");
    expect(lines[2]).toContain("processTurn");
  });

  it("excludes the synthetic (root) node from the report", () => {
    const summary = formatAllocationProfile(fixture, 25);
    expect(summary).not.toContain("(root)");
  });

  it("returns a human-readable error string when the profile shape is malformed", () => {
    const summary = formatAllocationProfile({} as unknown as SamplingHeapProfile, 5);
    expect(summary).toMatch(/profile unavailable|malformed/i);
  });

  it("caps output at maxLines even when more nodes exist", () => {
    const summary = formatAllocationProfile(fixture, 2);
    const lines = summary.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

describe("captureAllocationProfile concurrency guard", () => {
  // V8's HeapProfiler.startSampling is process-global — two concurrent
  // captures would corrupt each other's sampling state. The guard rejects
  // the second caller with a typed error so the HTTP route can return 409.

  beforeEach(() => {
    __resetAllocationProfileBusyForTest();
  });

  it("rejects a second concurrent capture with AllocationProfileBusyError", async () => {
    // First capture: hold it open with a long sleep that we resolve manually.
    let releaseFirstSleep!: () => void;
    const firstSleep = new Promise<void>((resolve) => {
      releaseFirstSleep = resolve;
    });
    const firstCapture = captureAllocationProfile({
      durationMs: 60_000,
      fakeProfile: fixture,
      sleep: () => firstSleep,
    });

    // While the first is in-flight, isAllocationProfileCaptureInProgress
    // must reflect that and a second call must reject immediately.
    expect(isAllocationProfileCaptureInProgress()).toBe(true);
    await expect(
      captureAllocationProfile({ durationMs: 60_000, fakeProfile: fixture })
    ).rejects.toBeInstanceOf(AllocationProfileBusyError);

    // Release the first so we don't leak a pending promise into the next test.
    releaseFirstSleep();
    await firstCapture;
    expect(isAllocationProfileCaptureInProgress()).toBe(false);
  });

  it("releases the busy flag even when the underlying capture throws", async () => {
    // Stub captureAllocationProfile by handing in fakeProfile + a sleep that
    // rejects. The finally-block must still clear the busy flag.
    await expect(
      captureAllocationProfile({
        durationMs: 1,
        fakeProfile: fixture,
        sleep: () => Promise.reject(new Error("kaboom")),
      })
    ).rejects.toThrow("kaboom");
    expect(isAllocationProfileCaptureInProgress()).toBe(false);
  });
});

describe("startAllocationProfileInBackground (async pattern)", () => {
  // Necessary because Cloudflare disconnects clients after ~100s and any
  // sample longer than that would 524. POST kicks off, GET retrieves later.

  beforeEach(() => {
    __resetAllocationProfileBusyForTest();
  });

  it("returns synchronously with start timestamps and marks the capture as in-progress", async () => {
    // Use a sleep we control so we can observe the in-progress state without
    // waiting for a real timer.
    let releaseSleep!: () => void;
    const heldSleep = new Promise<void>((r) => {
      releaseSleep = r;
    });

    const started = startAllocationProfileInBackground({
      durationMs: 30_000,
      fakeProfile: fixture,
      sleep: () => heldSleep,
    });

    expect(started.durationMs).toBe(30_000);
    expect(started.startedAt).toBeTruthy();
    expect(started.estimatedFinishAt).toBeTruthy();
    expect(isAllocationProfileCaptureInProgress()).toBe(true);
    expect(getCurrentCaptureState()).not.toBeNull();
    expect(getCurrentCaptureState()!.startedAt).toBe(started.startedAt);

    releaseSleep();
    // Give the microtask queue a chance to run the background finally block.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(getCurrentCaptureState()).toBeNull();
  });

  it("stashes the completed profile in getLastAllocationProfileResult", async () => {
    startAllocationProfileInBackground({
      durationMs: 1,
      fakeProfile: fixture,
      sleep: () => Promise.resolve(),
    });
    // Let the background promise drain.
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));

    const result = getLastAllocationProfileResult();
    expect(result).not.toBeNull();
    expect(result!.profile).toBe(fixture);
    expect(result!.durationMs).toBe(1);
    expect(getLastAllocationProfileError()).toBeNull();
  });

  it("stashes errors in getLastAllocationProfileError when the capture fails", async () => {
    startAllocationProfileInBackground({
      durationMs: 1,
      fakeProfile: fixture,
      sleep: () => Promise.reject(new Error("inspector crashed")),
    });
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));

    const err = getLastAllocationProfileError();
    expect(err).not.toBeNull();
    expect(err!.message).toBe("inspector crashed");
    expect(err!.at).toBeTruthy();
    expect(getLastAllocationProfileResult()).toBeNull();
  });

  it("rejects a second background-start while the first is still in flight", () => {
    let releaseSleep!: () => void;
    const heldSleep = new Promise<void>((r) => {
      releaseSleep = r;
    });
    startAllocationProfileInBackground({
      durationMs: 30_000,
      fakeProfile: fixture,
      sleep: () => heldSleep,
    });

    expect(() =>
      startAllocationProfileInBackground({
        durationMs: 1,
        fakeProfile: fixture,
      })
    ).toThrow(AllocationProfileBusyError);

    releaseSleep();
  });
});
