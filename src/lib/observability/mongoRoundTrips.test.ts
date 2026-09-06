import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  beginPhaseProfiling,
  endPhaseProfiling,
  formatRoundTripReport,
  recordRoundTrip,
  recordDocumentsReturned,
  totalBytesReturned,
  resetRoundTripProfiler,
  roundTripProfilingEnabled,
  roundTripReport,
  totalDocumentsReturned,
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
      documents: 0,
      bytes: 0,
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
    expect(text).toContain("100 round trips");
    expect(text).toContain("heavy");
    expect(text).toContain("corporations 0.0M/0d/75t");
  });
});

describe("document counting", () => {
  /**
   * Round trips rank what production pays (latency per call); documents rank
   * what singleplayer pays (deserialization per document). They diverge
   * sharply — one aggregate returning 61,398 documents is a single round trip
   * — so the profiler has to carry both.
   */
  it("attributes returned documents to the open phase", () => {
    enable();
    beginPhaseProfiling("economicVitalSigns");
    recordRoundTrip("ledgerEntries");
    recordDocumentsReturned("ledgerEntries", 61398);
    endPhaseProfiling("economicVitalSigns");

    const row = roundTripReport()[0]!;
    expect(row).toMatchObject({ phase: "economicVitalSigns", roundTrips: 1, documents: 61398 });
    expect(row.topCollections[0]).toEqual({
      collection: "ledgerEntries",
      roundTrips: 1,
      documents: 61398,
      bytes: 0,
    });
  });

  it("ranks phases by documents, not by round trips", () => {
    enable();
    beginPhaseProfiling("chatty");
    for (let i = 0; i < 500; i++) {
      recordRoundTrip("gameState");
      recordDocumentsReturned("gameState", 1);
    }
    endPhaseProfiling("chatty");

    beginPhaseProfiling("heavy");
    recordRoundTrip("ledgerEntries");
    recordDocumentsReturned("ledgerEntries", 61398);
    endPhaseProfiling("heavy");

    // "chatty" wins on round trips, "heavy" on documents. Documents decide.
    expect(roundTripReport().map((r) => r.phase)).toEqual(["heavy", "chatty"]);
    expect(totalDocumentsReturned()).toBe(61898);
    expect(totalRoundTrips()).toBe(501);
  });

  /**
   * Documents are not equal: an NPP is 31KB and a fund position is 150 bytes.
   * Bytes are what BSON decoding actually costs, so when they are known they
   * outrank the document count.
   */
  it("ranks phases by bytes ahead of documents", () => {
    enable();
    beginPhaseProfiling("manySmall");
    recordRoundTrip("indexFundPositions");
    recordDocumentsReturned("indexFundPositions", 7000, 7000 * 150);
    endPhaseProfiling("manySmall");

    beginPhaseProfiling("fewFat");
    recordRoundTrip("npps");
    recordDocumentsReturned("npps", 1700, 1700 * 31_000);
    endPhaseProfiling("fewFat");

    const report = roundTripReport();
    expect(report.map((r) => r.phase)).toEqual(["fewFat", "manySmall"]);
    expect(report[0]!.bytes).toBe(1700 * 31_000);
    expect(report[0]!.topCollections[0]).toMatchObject({
      collection: "npps",
      bytes: 1700 * 31_000,
    });
    expect(totalBytesReturned()).toBe(1700 * 31_000 + 7000 * 150);

    const text = formatRoundTripReport()!;
    expect(text).toContain("BSON returned this turn");
    expect(text).toContain("npps 50.3M/1700d/1t");
  });

  it("ignores empty and negative batches", () => {
    enable();
    beginPhaseProfiling("p");
    recordDocumentsReturned("things", 0);
    recordDocumentsReturned("things", -5);
    endPhaseProfiling("p");

    expect(totalDocumentsReturned()).toBe(0);
  });

  it("records nothing when profiling is off", () => {
    delete process.env.AHD_TURN_ROUNDTRIP_PROFILE;
    resetRoundTripProfiler();
    recordDocumentsReturned("things", 100);

    expect(totalDocumentsReturned()).toBe(0);
  });
});

describe("attribution via the audit context", () => {
  /**
   * runPhase establishes an AsyncLocalStorage audit context per phase with a
   * "turn:<n>:<phase>" trace id. Preferring it over the mutable pointer is what
   * lets a read issued from an async continuation still land on its phase.
   */
  it("attributes to the phase named in the audit trace id", async () => {
    enable();
    const { runInAuditContext } = await import("@/lib/observability/context");

    runInAuditContext("turn:42:corporationTurn", () => {
      recordRoundTrip("corporateSectors");
      recordDocumentsReturned("corporateSectors", 3140);
    });

    expect(roundTripReport()[0]).toMatchObject({
      phase: "corporationTurn",
      documents: 3140,
    });
  });

  it("survives an await inside the phase, which the mutable pointer cannot", async () => {
    enable();
    const { runInAuditContext } = await import("@/lib/observability/context");

    await runInAuditContext("turn:42:economicVitalSigns", async () => {
      await Promise.resolve();
      recordDocumentsReturned("ledgerEntries", 61398);
    });

    expect(roundTripReport()[0]).toMatchObject({
      phase: "economicVitalSigns",
      documents: 61398,
    });
  });

  it("keeps phase names that contain colons intact", async () => {
    enable();
    const { runInAuditContext } = await import("@/lib/observability/context");

    runInAuditContext("turn:7:some:odd:phase", () => recordRoundTrip("things"));

    expect(roundTripReport()[0]!.phase).toBe("some:odd:phase");
  });

  it("falls back to the bracket for non-phase spans with no audit context", () => {
    enable();
    beginPhaseProfiling("turnSetup");
    recordDocumentsReturned("states", 238);
    endPhaseProfiling("turnSetup");

    expect(roundTripReport()[0]).toMatchObject({ phase: "turnSetup", documents: 238 });
  });

  it("ignores trace ids that are not turn phases", async () => {
    enable();
    const { runInAuditContext } = await import("@/lib/observability/context");

    runInAuditContext("api:some-request", () => recordRoundTrip("things"));

    expect(roundTripReport()[0]!.phase).toBe("(outside any phase)");
  });
});
