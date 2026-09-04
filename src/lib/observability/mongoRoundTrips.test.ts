import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  beginPhaseProfiling,
  endPhaseProfiling,
  formatRoundTripReport,
  recordRoundTrip,
  resetRoundTripProfiler,
  roundTripProfilingEnabled,
  roundTripReport,
  totalRoundTrips,
} from "./mongoRoundTrips";

const ORIGINAL = process.env.AHD_TURN_ROUNDTRIP_PROFILE;

function enable() {
  process.env.AHD_TURN_ROUNDTRIP_PROFILE = "1";
  resetRoundTripProfiler();
}

beforeEach(() => resetRoundTripProfiler());

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AHD_TURN_ROUNDTRIP_PROFILE;
  else process.env.AHD_TURN_ROUNDTRIP_PROFILE = ORIGINAL;
  resetRoundTripProfiler();
});

describe("round-trip profiler", () => {
  it("stays completely inert unless the flag is set", () => {
    delete process.env.AHD_TURN_ROUNDTRIP_PROFILE;
    resetRoundTripProfiler();

    expect(roundTripProfilingEnabled()).toBe(false);
    beginPhaseProfiling("corporationTurn");
    recordRoundTrip("corporations");
    endPhaseProfiling("corporationTurn");

    expect(totalRoundTrips()).toBe(0);
    expect(formatRoundTripReport()).toBeNull();
  });

  it("attributes commands to the phase that is open", () => {
    enable();

    beginPhaseProfiling("corporationTurn");
    recordRoundTrip("corporations");
    recordRoundTrip("corporations");
    recordRoundTrip("indexFunds");
    endPhaseProfiling("corporationTurn");

    beginPhaseProfiling("voteAccumulation");
    recordRoundTrip("elections");
    endPhaseProfiling("voteAccumulation");

    const report = roundTripReport();
    expect(report[0]).toMatchObject({ phase: "corporationTurn", roundTrips: 3 });
    expect(report[1]).toMatchObject({ phase: "voteAccumulation", roundTrips: 1 });
    expect(totalRoundTrips()).toBe(4);
  });

  it("ranks phases by round trips, heaviest first", () => {
    enable();
    for (const [phase, n] of [
      ["light", 2],
      ["heavy", 50],
      ["middling", 10],
    ] as const) {
      beginPhaseProfiling(phase);
      for (let i = 0; i < n; i++) recordRoundTrip("things");
      endPhaseProfiling(phase);
    }

    expect(roundTripReport().map((r) => r.phase)).toEqual(["heavy", "middling", "light"]);
  });

  it("names the collection a phase hammers, which is what identifies an N+1", () => {
    enable();
    beginPhaseProfiling("nppActionProcessing");
    for (let i = 0; i < 300; i++) recordRoundTrip("corporations");
    recordRoundTrip("npps");
    endPhaseProfiling("nppActionProcessing");

    expect(roundTripReport()[0]!.topCollections[0]).toEqual({
      collection: "corporations",
      roundTrips: 300,
    });
  });

  it("books work outside any phase rather than silently dropping it", () => {
    enable();
    recordRoundTrip("gameState");

    expect(roundTripReport()[0]).toMatchObject({
      phase: "(outside any phase)",
      roundTrips: 1,
    });
  });

  it("does not let a late async tail from a finished phase blank the current one", () => {
    enable();
    beginPhaseProfiling("first");
    endPhaseProfiling("first");
    beginPhaseProfiling("second");
    // "first" finishing again must not steal attribution from "second".
    endPhaseProfiling("first");
    recordRoundTrip("things");

    expect(roundTripReport()[0]).toMatchObject({ phase: "second", roundTrips: 1 });
  });

  it("renders a report with shares that a human can read", () => {
    enable();
    beginPhaseProfiling("heavy");
    for (let i = 0; i < 75; i++) recordRoundTrip("corporations");
    endPhaseProfiling("heavy");
    beginPhaseProfiling("light");
    for (let i = 0; i < 25; i++) recordRoundTrip("npps");
    endPhaseProfiling("light");

    const text = formatRoundTripReport()!;
    expect(text).toContain("100 Mongo round trips");
    expect(text).toContain("heavy");
    expect(text).toContain("75.0%");
    expect(text).toContain("corporations x75");
  });
});
