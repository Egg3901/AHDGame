import { describe, expect, it } from "vitest";
import { TURN_PHASE_NAMES } from "@/simulation/phases/turnPhaseNames";
import { COUNTRY_BILL_PHASES } from "@/lib/turn/countryPhases";
import { attributeTurn, cadenceTier, classifyPhase, summarize } from "./turnAttribution";

const at = (s: number) => new Date(Date.UTC(2026, 8, 30, 12, 0, s)).toISOString();
const phase = (a: number, b: number, roundTrips = 0) => ({
  status: "completed",
  startedAt: at(a),
  completedAt: at(b),
  roundTrips,
});

describe("classifyPhase", () => {
  it("maps every registered turn phase and country bill phase to a subsystem", () => {
    const names = [
      ...TURN_PHASE_NAMES,
      ...Object.values(COUNTRY_BILL_PHASES).map((entry) => entry!.phaseName),
    ];
    const unmapped = names.filter((name) => classifyPhase(name) === null);
    expect(unmapped).toEqual([]);
  });

  it("routes pattern families", () => {
    expect(classifyPhase("nppUnionBehavior")).toBe("NPP agents");
    expect(classifyPhase("frSenateElections")).toBe("Elections & campaigns");
    expect(classifyPhase("deBillLifecycle")).toBe("Governance & opinion");
    expect(classifyPhase("metricHistory")).toBe("History & integrity scans");
    expect(classifyPhase("notARealPhase")).toBeNull();
  });
});

describe("attributeTurn", () => {
  it("splits overlapping intervals equally so attribution sums to covered wall time", () => {
    const row = attributeTurn({
      turn: 1201,
      realTime: at(0),
      durationMs: 10_000,
      phaseStatuses: {
        corporationTurn: phase(0, 6, 100), // alone 0-2, shared 2-6
        fundGeneration: phase(2, 6, 10), // shared 2-6
        metricHistory: phase(6, 10, 7), // alone 6-10
        skippedThing: { status: "skipped" },
      },
    });
    expect(row.naivePhaseSumMs).toBe(14_000);
    expect(row.coveredMs).toBe(10_000);
    expect(row.phaseMs.corporationTurn).toBe(4_000);
    expect(row.phaseMs.fundGeneration).toBe(2_000);
    expect(row.subsystemMs["Corporations & sectors"]).toBe(4_000);
    expect(row.subsystemMs["Capital markets & banking"]).toBe(2_000);
    expect(row.subsystemMs["History & integrity scans"]).toBe(4_000);
    expect(row.roundTrips).toBe(117);
    expect(row.tier).toBe("quiet");
  });

  it("reports gaps as uncovered time and ignores intervals outside the turn", () => {
    const row = attributeTurn({
      turn: 1204,
      realTime: at(0),
      durationMs: 10_000,
      phaseStatuses: { bondTurn: phase(1, 4), metricHistory: phase(-5, -1) },
    });
    expect(row.coveredMs).toBe(3_000);
    expect(row.tier).toBe("nppAction");
  });

  it("lists unmapped phases so new phases cannot vanish from the totals", () => {
    const row = attributeTurn({
      turn: 1,
      realTime: at(0),
      durationMs: 2_000,
      phaseStatuses: { brandNewPhase: phase(0, 2) },
    });
    expect(row.unmappedPhases).toEqual(["brandNewPhase"]);
  });
});

describe("cadenceTier and summarize", () => {
  it("classifies the engine cadences", () => {
    expect(cadenceTier(1248)).toBe("fundRebalance");
    expect(cadenceTier(1252)).toBe("nppAction");
    expect(cadenceTier(1253)).toBe("quiet");
  });

  it("summarizes means, medians and minimum coverage", () => {
    const rows = [1201, 1202, 1204].map((turn, i) =>
      attributeTurn({
        turn,
        realTime: at(0),
        durationMs: 4_000,
        phaseStatuses: { corporationTurn: phase(0, 2 + i, 10 * (i + 1)) },
      })
    );
    const s = summarize(rows);
    expect(s.turns).toBe(3);
    expect(s.medianWallMs).toBe(4_000);
    expect(s.minCoverage).toBe(0.5);
    expect(s.subsystemMeanMs["Corporations & sectors"]).toBe(3_000);
    expect(s.byTier.quiet.turns).toBe(2);
    expect(s.byTier.nppAction.medianRoundTrips).toBe(30);
  });
});
