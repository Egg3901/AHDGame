import { describe, it, expect } from "vitest";
import {
  LONG_HORIZON_APPROVAL_CALC_VERSION,
  LONG_HORIZON_MACRO_CALC_VERSION,
  LONG_HORIZON_MACRO_PATHS,
  LONG_HORIZON_RETENTION_POLICY_ID,
  LONG_HORIZON_RETENTION_POLICY_VERSION,
  LONG_HORIZON_TELEMETRY_SCHEMA_VERSION,
  buildApprovalPoint,
  buildMacroPoint,
  buildWorldId,
  isFoundingTurn,
  longHorizonReportTurnRange,
  markMissing,
  resolveSourceClass,
} from "./rules";

const BASE_APPROVAL_INPUT = {
  worldId: "1991-default:Beta-3",
  sourceClass: "sandbox" as const,
  runId: "1991-r3",
  turn: 100,
  year: 1993,
  foundingTurn: false,
  country: "US",
  region: null,
};

describe("long-horizon telemetry rules", () => {
  it("versions and retention policy are explicit constants", () => {
    expect(LONG_HORIZON_TELEMETRY_SCHEMA_VERSION).toBe(1);
    expect(LONG_HORIZON_APPROVAL_CALC_VERSION).toBe(1);
    expect(LONG_HORIZON_MACRO_CALC_VERSION).toBe(1);
    expect(LONG_HORIZON_RETENTION_POLICY_ID).toBe("world-raw-full");
    expect(LONG_HORIZON_RETENTION_POLICY_VERSION).toBe(1);
  });

  it("covers the GDP and population metric paths with units", () => {
    const paths = LONG_HORIZON_MACRO_PATHS.map((p) => p.path);
    expect(paths).toContain("economic.gdp");
    expect(paths).toContain("population.population");
    for (const p of LONG_HORIZON_MACRO_PATHS) {
      expect(p.units.length).toBeGreaterThan(0);
    }
  });

  it("builds a stable world id from preset and iteration", () => {
    expect(
      buildWorldId({ preset: "1991-default", iterationType: "Beta", iterationNumber: 3 })
    ).toBe("1991-default:Beta-3");
    // Missing iteration degrades deterministically, never throws.
    expect(buildWorldId({})).toBe("unknown:unknown-0");
  });

  it("resolves the source class from the database name and singleplayer flag", () => {
    expect(resolveSourceClass({ dbName: "ahd_sim_1991_r3", hasSingleplayerConfig: false })).toBe(
      "sandbox"
    );
    expect(resolveSourceClass({ dbName: "ahd_game", hasSingleplayerConfig: false })).toBe(
      "multiplayer"
    );
    expect(resolveSourceClass({ dbName: "ahd_local", hasSingleplayerConfig: true })).toBe(
      "singleplayer"
    );
    // A singleplayer-configured world inside a sim-prefixed db is still a sim.
    expect(resolveSourceClass({ dbName: "ahd_sim_probe", hasSingleplayerConfig: true })).toBe(
      "sandbox"
    );
  });

  it("marks founding-election turns from the pre-iteration clock", () => {
    // Completed founding phase: raw turns at or below the offset were founding.
    expect(isFoundingTurn(1, { preIterationTurns: 5 })).toBe(true);
    expect(isFoundingTurn(5, { preIterationTurns: 5 })).toBe(true);
    expect(isFoundingTurn(6, { preIterationTurns: 5 })).toBe(false);
    // Active founding phase: everything so far is founding.
    expect(isFoundingTurn(3, { preIterationActive: true })).toBe(true);
    // Normal worlds have no founding turns.
    expect(isFoundingTurn(1, {})).toBe(false);
    expect(isFoundingTurn(200, {})).toBe(false);
  });

  it("builds national and regional approval points with full provenance", () => {
    const national = buildApprovalPoint({
      ...BASE_APPROVAL_INPUT,
      region: null,
      approval: 52.4,
      net: 4.8,
      governingActor: { party: "9", officeType: "president", nppId: "npp-9" },
    });
    expect(national.turn).toBe(100);
    expect(national.year).toBe(1993);
    expect(national.region).toBeNull();
    expect(national.approval).toBe(52.4);
    expect(national.netApproval).toBe(4.8);
    expect(national.governingParty).toBe("9");
    expect(national.governingNpp).toBe("npp-9");
    expect(national.schemaVersion).toBe(1);
    expect(national.calcVersion).toBe(LONG_HORIZON_APPROVAL_CALC_VERSION);
    expect(national.retentionPolicy).toBe(LONG_HORIZON_RETENTION_POLICY_ID);

    const regional = buildApprovalPoint({
      ...BASE_APPROVAL_INPUT,
      region: "PA",
      approval: 48.1,
      net: -3.8,
    });
    expect(regional.region).toBe("PA");
    expect(regional.governingParty).toBeUndefined();
  });

  it("builds macro points and refuses to invent values for non-finite input", () => {
    const point = buildMacroPoint({
      ...BASE_APPROVAL_INPUT,
      region: "TX",
      metric: "economic.gdp",
      value: 2_300,
      units: "local-currency millions",
    });
    expect(point?.value).toBe(2_300);
    expect(point?.metric).toBe("economic.gdp");
    expect(point?.calcVersion).toBe(LONG_HORIZON_MACRO_CALC_VERSION);

    // Missing data stays missing: never inferred as zero.
    expect(
      buildMacroPoint({
        ...BASE_APPROVAL_INPUT,
        region: "TX",
        metric: "economic.gdp",
        value: Number.NaN,
        units: "local-currency millions",
      })
    ).toBeNull();
    expect(
      buildMacroPoint({
        ...BASE_APPROVAL_INPUT,
        region: "TX",
        metric: "economic.gdp",
        value: Number.POSITIVE_INFINITY,
        units: "local-currency millions",
      })
    ).toBeNull();
  });

  it("retains a full 480-turn approval series where the 20-cap keeps 20", () => {
    const series = [];
    for (let turn = 1; turn <= 480; turn++) {
      series.push(
        buildApprovalPoint({
          ...BASE_APPROVAL_INPUT,
          runId: "480-run",
          turn,
          year: 1991 + Math.floor((turn - 1) / 48),
          foundingTurn: isFoundingTurn(turn, { preIterationTurns: 5 }),
          approval: 50 + (turn % 7),
          net: (turn % 7) * 2,
        })
      );
    }
    // The durable series keeps every turn; the old operational cap keeps 20.
    expect(series).toHaveLength(480);
    expect(series[0].turn).toBe(1);
    expect(series[479].turn).toBe(480);
    expect(series[479].year).toBe(1991 + 9);
    expect(series.slice(-20)).toHaveLength(20);
    // Founding-election turns stay distinguishable across the full run.
    expect(series.filter((p) => p.foundingTurn).map((p) => p.turn)).toEqual([1, 2, 3, 4, 5]);
  });

  it("retains a full 480-turn macro series where the 96-cap keeps 96", () => {
    const series = [];
    for (let turn = 1; turn <= 480; turn++) {
      const point = buildMacroPoint({
        ...BASE_APPROVAL_INPUT,
        region: "TX",
        turn,
        year: 1991 + Math.floor((turn - 1) / 48),
        foundingTurn: false,
        metric: "economic.gdp",
        value: 2_000 + turn,
        units: "local-currency millions",
      });
      if (point) series.push(point);
    }
    expect(series).toHaveLength(480);
    expect(series[0].turn).toBe(1);
    expect(series[479].turn).toBe(480);
    expect(series.slice(-96)).toHaveLength(96);
  });

  it("marks gaps as missing, never as zero", () => {
    const points = [
      { turn: 10, value: 2.1 },
      { turn: 12, value: 2.4 },
    ];
    const marked = markMissing(points, 10, 12);
    expect(marked).toEqual([
      { turn: 10, value: 2.1, missing: false },
      { turn: 11, value: null, missing: true },
      { turn: 12, value: 2.4, missing: false },
    ]);
    // A missing point is null, not 0: 0 would read as stagnation.
    expect(marked[1].value).toBeNull();
    expect(marked[1].value).not.toBe(0);
  });

  it("starts report cardinality after a cloned world's captured baseline", () => {
    expect(longHorizonReportTurnRange(120, 123)).toEqual({ from: 121, to: 123 });
    expect(longHorizonReportTurnRange(0, 3)).toEqual({ from: 1, to: 3 });
    expect(longHorizonReportTurnRange(123, 123)).toBeNull();
  });
});
