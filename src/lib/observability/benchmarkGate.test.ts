import { describe, expect, it } from "vitest";
import {
  benchmarkCaseFor,
  buildBenchmarkResult,
  compareBenchmarks,
  featurePostureEntries,
  type BenchmarkIdentity,
  type BenchmarkResult,
} from "./benchmarkGate";
import type { TurnLogLike } from "./turnAttribution";

const identity: BenchmarkIdentity = {
  snapshot: "aged-1991-t481.archive.gz",
  sourceDb: "sim",
  startTurn: 481,
  warmupTurns: 1,
  rngSeed: "bench",
  featurePosture: "abc",
};

function log(turn: number, durationMs: number, phases: Record<string, [number, number]>) {
  const t0 = Date.UTC(2026, 9, 5, 0, 0, 0);
  let cursor = t0;
  const phaseStatuses: TurnLogLike["phaseStatuses"] = {};
  for (const [name, [ms, roundTrips]] of Object.entries(phases)) {
    phaseStatuses[name] = {
      status: "completed",
      startedAt: new Date(cursor).toISOString(),
      completedAt: new Date(cursor + ms).toISOString(),
      roundTrips,
    };
    cursor += ms;
  }
  return { turn, realTime: new Date(t0).toISOString(), durationMs, phaseStatuses };
}

describe("benchmarkCaseFor", () => {
  it("separates quiet, NPP-action, rebalance and election-deadline turns", () => {
    const deadlines = new Set([485]);
    expect(benchmarkCaseFor(483, deadlines)).toBe("quiet");
    expect(benchmarkCaseFor(484, deadlines)).toBe("nppAction");
    expect(benchmarkCaseFor(480, deadlines)).toBe("fundRebalance");
    expect(benchmarkCaseFor(485, deadlines)).toBe("electionDeadline");
  });
});

describe("buildBenchmarkResult", () => {
  it("reports medians per case from attributed, not summed, phase time", () => {
    const result = buildBenchmarkResult({
      identity,
      sourceRevision: "abc123",
      electionDeadlineTurns: new Set(),
      logs: [
        log(482, 10_000, { corporationTurn: [6_000, 900], voteAccumulation: [4_000, 300] }),
        log(483, 12_000, { corporationTurn: [8_000, 1_100], voteAccumulation: [4_000, 300] }),
        log(484, 20_000, { corporationTurn: [8_000, 1_000], nppActionProcessing: [12_000, 5_000] }),
      ],
    });
    expect(result.cases.quiet).toMatchObject({
      turns: [482, 483],
      medianWallMs: 11_000,
      medianRoundTrips: 1_300,
      phaseRoundTrips: { corporationTurn: 1_000, voteAccumulation: 300 },
      phaseMs: { corporationTurn: 7_000, voteAccumulation: 4_000 },
    });
    expect(result.cases.nppAction?.turns).toEqual([484]);
    expect(result.cases.fundRebalance).toBeUndefined();
  });
});

describe("compareBenchmarks", () => {
  const base: BenchmarkResult = {
    identity,
    sourceRevision: "before",
    cases: {
      quiet: {
        turns: [482],
        medianWallMs: 100_000,
        medianRoundTrips: 15_000,
        phaseRoundTrips: { corporationTurn: 1_000, tiny: 50 },
        phaseMs: {},
      },
    },
  };
  const withQuiet = (
    patch: Partial<NonNullable<BenchmarkResult["cases"]["quiet"]>>
  ): BenchmarkResult => ({
    ...base,
    sourceRevision: "after",
    cases: { quiet: { ...base.cases.quiet!, ...patch } },
  });

  it("passes an improvement and records it", () => {
    const verdict = compareBenchmarks(
      base,
      withQuiet({ medianWallMs: 80_000, medianRoundTrips: 12_000 })
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.improvements.join("\n")).toMatch(/quiet round trips: 15000 -> 12000/);
  });

  it("fails a case or phase round-trip regression past the tolerance", () => {
    expect(compareBenchmarks(base, withQuiet({ medianRoundTrips: 16_000 })).ok).toBe(false);
    const phase = compareBenchmarks(
      base,
      withQuiet({ phaseRoundTrips: { corporationTurn: 1_200, tiny: 500 } })
    );
    expect(phase.ok).toBe(false);
    // Phases under the minimum are not gated on their own.
    expect(phase.regressions).toEqual(["quiet corporationTurn round trips: 1000 -> 1200 (20.0%)"]);
  });

  it("tolerates wall-time noise inside the tolerance", () => {
    expect(compareBenchmarks(base, withQuiet({ medianWallMs: 108_000 })).ok).toBe(true);
    expect(compareBenchmarks(base, withQuiet({ medianWallMs: 115_000 })).ok).toBe(false);
  });

  it("refuses results from a different snapshot, seed or feature posture", () => {
    const verdict = compareBenchmarks(base, {
      ...withQuiet({}),
      identity: { ...identity, rngSeed: "other", featurePosture: "def" },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.mismatches).toEqual(["rngSeed: bench vs other", "featurePosture: abc vs def"]);
  });

  it("fails when a baseline case was not measured", () => {
    const verdict = compareBenchmarks(base, { ...base, cases: {} });
    expect(verdict).toMatchObject({ ok: false, missingCases: ["quiet"] });
  });
});

describe("featurePostureEntries", () => {
  it("keeps flags and modes, drops ids, counters and clocks, and sorts", () => {
    expect(
      featurePostureEntries(
        { _id: "default", simSandbox: true, labourSystemMode: "full", turnLengthMinutes: 60 },
        { _id: "current", currentTurn: 481, nppAutonomyLevel: "v5", indexFundsEnabled: false }
      )
    ).toEqual([
      ["0.labourSystemMode", "full"],
      ["0.simSandbox", "true"],
      ["1.indexFundsEnabled", "false"],
      ["1.nppAutonomyLevel", "v5"],
    ]);
  });
});
