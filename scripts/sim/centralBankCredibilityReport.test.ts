import { describe, expect, it } from "vitest";
import {
  buildCentralBankCredibilityReport,
  type CredibilityRunManifest,
} from "./centralBankCredibilityReport";
import type { CentralBankCredibilityPoint } from "./centralBankCredibilitySnapshot";

const manifest: CredibilityRunManifest = {
  runId: "run",
  seed: "seed",
  status: "completed",
  source: { executedCommit: "a".repeat(40) },
  centralBankCredibilityTelemetry: {
    schemaVersion: 1,
    expectedFirstTurn: 0,
    expectedLastTurn: 2,
    bankIds: ["US"],
  },
};
const points: CentralBankCredibilityPoint[] = [0, 1, 2].map((turn) => ({
  _id: `run:${turn}:US`,
  schemaVersion: 1,
  runId: "run",
  seed: "seed",
  codeVersion: "a".repeat(40),
  sourceClass: "sandbox",
  observation: "completed-turn-state",
  observedAt: "2026-10-04T00:00:00.000Z",
  turn,
  year: 2027,
  bankId: "US",
  countryId: "US",
  monetaryAuthorityId: null,
  endPrimeRatePct: 3,
  scrutiny: 20 - turn,
  resolveStreak: turn,
  countryInflationPct: 2,
  nationalGdpGrowthPct: turn === 0 ? null : 2,
}));
const interval = { firstTurn: 0, lastTurn: 2 };

describe("world credibility evidence qualification", () => {
  it("keeps aligned observed paths and explicit missing values", () => {
    const report = buildCentralBankCredibilityReport(manifest, [...points].reverse(), interval);
    expect(report.captureQualification).toBe("complete");
    expect(report.points.map((point) => point.turn)).toEqual([0, 1, 2]);
    expect(report.missingValues.nationalGdpGrowthPct).toBe(1);
    expect(report.points[0].nationalGdpGrowthPct).toBeNull();
  });

  it("rejects a missing turn or a duplicate observation", () => {
    expect(
      buildCentralBankCredibilityReport(manifest, points.slice(1), interval).reasons
    ).toContain("missing 0:US");
    expect(
      buildCentralBankCredibilityReport(manifest, [...points, points[0]], interval).reasons
    ).toContain("duplicate 0:US");
  });

  it.each([{ runId: "other" }, { seed: "other" }, { codeVersion: "b".repeat(40) }])(
    "rejects mixed run provenance %j",
    (override) => {
      const report = buildCentralBankCredibilityReport(
        manifest,
        [{ ...points[0], ...override }, ...points.slice(1)],
        interval
      );
      expect(report.captureQualification).toBe("incomplete");
      expect(report.reasons).toContain("mixed provenance 0:US");
    }
  );

  it("does not qualify an unfinished run or an interval it never captured", () => {
    expect(
      buildCentralBankCredibilityReport({ ...manifest, status: "failed" }, points, interval)
        .captureQualification
    ).toBe("incomplete");
    expect(
      buildCentralBankCredibilityReport(manifest, points, { firstTurn: 0, lastTurn: 3 }).reasons
    ).toContain("missing or incompatible capture interval");
  });

  it("bounds the exported interval before enumerating expected rows", () => {
    expect(() =>
      buildCentralBankCredibilityReport(manifest, points, { firstTurn: 0, lastTurn: 241 })
    ).toThrow(/at most 240/);
    expect(() =>
      buildCentralBankCredibilityReport(manifest, points, { firstTurn: -1, lastTurn: 2 })
    ).toThrow();
  });
});
