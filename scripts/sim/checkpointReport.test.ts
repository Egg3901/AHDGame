/**
 * Tests for the checkpoint report's seed audit (`runSeedAudit`).
 *
 * Covers the check families added to close two confirmed blind spots:
 *   - "Zero-row blindness": a country with NO rows in a collection is
 *     invisible to any check that only inspects rows that exist. The B-family
 *     (coverage/absence) checks test presence directly instead.
 *   - "Frozen-value blindness": a value that is byte-identical across many
 *     turns, or pinned exactly on a bound (0), reads as calm to any check that
 *     only looks at the latest reading. The C (staleness) and D (trajectory)
 *     families read the whole per-turn series instead of the last point.
 *
 * Also covers the E-family cross-country outlier check and the self-audit
 * (checked vs skipped) bookkeeping that lets a report distinguish "verified
 * healthy" from "not examined".
 *
 * All of these are exercised against real broken-world data in the
 * checkpoint-audit rebuild write-up; this file locks down the pure-function
 * logic in isolation so a future edit can't silently regress it.
 */
import { describe, it, expect } from "vitest";
import { runSeedAudit, type AuditFinding } from "./checkpointReport";

/** A baseline input that produces zero findings from the pre-existing A-family checks. */
function baseInput(): Parameters<typeof runSeedAudit>[0] {
  return {
    players: [],
    series: {},
    fiscal: [],
    bandIndex: {},
    flags: {
      labourSystemMode: "full",
      marketSystemMode: "clearing",
      demographicsDemandEnabled: false,
      householdConsumptionEnabled: true,
      commandEconomyEnabled: true,
    },
    zeroGrowthByCountry: {},
  };
}

function idsFor(findings: AuditFinding[], id: string): string[] {
  return findings
    .filter((f) => f.id === id)
    .map((f) => f.countryId)
    .sort();
}

describe("runSeedAudit — B family (absence/coverage)", () => {
  it("flags every expected country with zero rows in a collection", () => {
    const result = runSeedAudit({
      ...baseInput(),
      presetId: "test-preset",
      expectedCountries: ["AA", "BB", "CC"],
      coverageCounts: {
        corporateSectors: { AA: 5, BB: 0 }, // CC absent entirely — must still count as 0
        corporations: { AA: 1, BB: 1, CC: 1 },
      },
    });
    expect(idsFor(result.findings, "B1-sectors")).toEqual(["BB", "CC"]);
    expect(idsFor(result.findings, "B2-corps")).toEqual([]);
    const bb = result.findings.find((f) => f.id === "B1-sectors" && f.countryId === "BB")!;
    expect(bb.severity).toBe("critical");
  });

  it("does not flag countries outside expectedCountries even with zero coverage", () => {
    const result = runSeedAudit({
      ...baseInput(),
      expectedCountries: ["AA"],
      coverageCounts: { corporateSectors: {} },
    });
    expect(idsFor(result.findings, "B1-sectors")).toEqual(["AA"]);
    expect(result.findings.some((f) => f.countryId === "ZZ")).toBe(false);
  });

  it("records a self-check skip and produces no B findings when expectedCountries is empty", () => {
    const result = runSeedAudit({
      ...baseInput(),
      expectedCountries: [],
      coverageCounts: { corporateSectors: {} },
    });
    expect(result.findings.filter((f) => f.id.startsWith("B"))).toEqual([]);
    expect(result.selfCheck.skipped.some((s) => s.id === "B-coverage")).toBe(true);
  });

  it("reports a checked entry naming the roster size when it runs", () => {
    const result = runSeedAudit({
      ...baseInput(),
      presetId: "1953-default",
      expectedCountries: ["AA", "BB"],
      coverageCounts: { corporateSectors: { AA: 1, BB: 1 } },
    });
    expect(result.selfCheck.checked.some((c) => c.includes("2 full-autonomous countries"))).toBe(
      true
    );
  });
});

describe("runSeedAudit — C family (staleness)", () => {
  it("flags nominal spending frozen across the trailing window while GDP moved", () => {
    const result = runSeedAudit({
      ...baseInput(),
      budgetSnapshotSeries: {
        AA: {
          turn: [1, 50, 100, 150],
          gdp: [100, 110, 120, 130],
          debtToGdp: [0.5, 0.5, 0.5, 0.5],
          spendTotal: [50, 50, 50, 50],
        },
      },
    });
    const finding = result.findings.find((f) => f.id === "C1-frozen-spend");
    expect(finding).toBeDefined();
    expect(finding!.countryId).toBe("AA");
    expect(finding!.severity).toBe("high");
  });

  it("does not flag a country whose GDP is equally frozen (indistinguishable from a static seed)", () => {
    const result = runSeedAudit({
      ...baseInput(),
      budgetSnapshotSeries: {
        AA: {
          turn: [1, 50, 100, 150],
          gdp: [100, 100, 100, 100],
          debtToGdp: [0.5, 0.5, 0.5, 0.5],
          spendTotal: [50, 50, 50, 50],
        },
      },
    });
    expect(idsFor(result.findings, "C1-frozen-spend")).toEqual([]);
  });

  it("does not flag a country whose spending genuinely varies", () => {
    const result = runSeedAudit({
      ...baseInput(),
      budgetSnapshotSeries: {
        AA: {
          turn: [1, 50, 100, 150],
          gdp: [100, 110, 120, 130],
          debtToGdp: [0.5, 0.5, 0.5, 0.5],
          spendTotal: [50, 55, 60, 65],
        },
      },
    });
    expect(idsFor(result.findings, "C1-frozen-spend")).toEqual([]);
  });
});

describe("runSeedAudit — D family (trajectory)", () => {
  it("flags D2-bound-zero when a ratio decays to exactly 0 and stays there", () => {
    const result = runSeedAudit({
      ...baseInput(),
      budgetSnapshotSeries: {
        AA: {
          turn: [1, 50, 100, 150],
          gdp: [100, 110, 120, 130],
          debtToGdp: [0.3, 0, 0, 0],
          spendTotal: [10, 20, 30, 40],
        },
      },
    });
    expect(idsFor(result.findings, "D2-bound-zero")).toEqual(["AA"]);
    // The more specific bound finding should win — no redundant ratchet-down too.
    expect(idsFor(result.findings, "D1-ratchet-down")).toEqual([]);
  });

  it("does not flag D2 when the ratio was always exactly 0 (never moved)", () => {
    const result = runSeedAudit({
      ...baseInput(),
      budgetSnapshotSeries: {
        AA: {
          turn: [1, 50, 100, 150],
          gdp: [100, 110, 120, 130],
          debtToGdp: [0, 0, 0, 0],
          spendTotal: [10, 20, 30, 40],
        },
      },
    });
    expect(idsFor(result.findings, "D2-bound-zero")).toEqual([]);
  });

  it("flags D1-ratchet-up for a monotonic full-window increase", () => {
    const result = runSeedAudit({
      ...baseInput(),
      budgetSnapshotSeries: {
        AA: {
          turn: [1, 50, 100, 150],
          gdp: [100, 110, 120, 130],
          debtToGdp: [0.1, 0.2, 0.3, 0.4],
          spendTotal: [10, 20, 30, 40],
        },
      },
    });
    const finding = result.findings.find((f) => f.id === "D1-ratchet-up");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
  });

  it("flags D1-ratchet-down (medium) for a monotonic decline that has not reached 0", () => {
    const result = runSeedAudit({
      ...baseInput(),
      budgetSnapshotSeries: {
        AA: {
          turn: [1, 50, 100, 150],
          gdp: [100, 110, 120, 130],
          debtToGdp: [0.9, 0.7, 0.6, 0.55],
          spendTotal: [10, 20, 30, 40],
        },
      },
    });
    const finding = result.findings.find((f) => f.id === "D1-ratchet-down");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
  });

  it("does not flag a series that reverses direction", () => {
    const result = runSeedAudit({
      ...baseInput(),
      budgetSnapshotSeries: {
        AA: {
          turn: [1, 50, 100, 150],
          gdp: [100, 110, 120, 130],
          debtToGdp: [0.3, 0.6, 0.4, 0.32],
          spendTotal: [10, 20, 30, 40],
        },
      },
    });
    expect(idsFor(result.findings, "D1-ratchet-up")).toEqual([]);
    expect(idsFor(result.findings, "D1-ratchet-down")).toEqual([]);
  });

  it("skips a country below the minimum snapshot window and records why", () => {
    const result = runSeedAudit({
      ...baseInput(),
      budgetSnapshotSeries: {
        AA: { turn: [1, 50], gdp: [100, 110], debtToGdp: [0.3, 0.3], spendTotal: [10, 10] },
      },
    });
    expect(result.findings.filter((f) => f.id.startsWith("C") || f.id.startsWith("D"))).toEqual([]);
    expect(
      result.selfCheck.skipped.some(
        (s) => s.id === "C-D-staleness-trajectory" && s.reason.includes("AA")
      )
    ).toBe(true);
  });
});

describe("runSeedAudit — E family (cross-country outliers)", () => {
  const peerCounts = (overrides: Record<string, number>) => ({
    corporateSectors: { A: 10, B: 12, C: 11, D: 9, E: 13, ...overrides },
    stateBudgets: { A: 2, B: 2, C: 2, D: 2, E: 2, F: 2 },
  });

  it("flags a clear high-side outlier against >=5 peers", () => {
    const result = runSeedAudit({
      ...baseInput(),
      expectedCountries: ["A", "B", "C", "D", "E", "F"],
      coverageCounts: peerCounts({ F: 200 }),
    });
    const finding = result.findings.find(
      (f) => f.id === "E1-sector-outlier" && f.countryId === "F"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
  });

  it("flags a clear low-side outlier against >=5 peers with high severity", () => {
    const result = runSeedAudit({
      ...baseInput(),
      expectedCountries: ["A", "B", "C", "D", "E", "F"],
      coverageCounts: peerCounts({ F: 1 }),
    });
    const finding = result.findings.find(
      (f) => f.id === "E1-sector-outlier" && f.countryId === "F"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
  });

  it("skips with a reason when fewer than 5 countries have a valid ratio", () => {
    const result = runSeedAudit({
      ...baseInput(),
      expectedCountries: ["A", "B", "C"],
      coverageCounts: {
        corporateSectors: { A: 10, B: 11, C: 12 },
        stateBudgets: { A: 2, B: 2, C: 2 },
      },
    });
    expect(result.findings.filter((f) => f.id === "E1-sector-outlier")).toEqual([]);
    expect(result.selfCheck.skipped.some((s) => s.id === "E-outlier")).toBe(true);
  });
});

describe("runSeedAudit — existing A-family + sorting regression", () => {
  it("still fires the pre-existing fiscal/band/inflation/growth-target/flag checks", () => {
    const result = runSeedAudit({
      players: ["ZZ"],
      series: {
        ZZ: {
          turn: [1],
          gdp: [1],
          gdpGrowth: [1],
          inflation: [16],
          interestRate: [2],
          corpRevenue: [1],
        },
      },
      fiscal: [
        {
          countryId: "ZZ",
          spendPctGdp: 150,
          deficitPctGdp: 60,
          debtToGdp: 3,
          rating: "D",
          crisis: "active",
        },
      ],
      bandIndex: { ZZ: 10 },
      flags: {},
      zeroGrowthByCountry: { ZZ: { zero: 2, total: 2 } },
    });
    const ids = result.findings.map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining(["A1-spend", "A1-deficit", "A2-band", "A3-clamp", "A4-target"])
    );
  });

  it("sorts findings critical -> high -> medium regardless of which family produced them", () => {
    const result = runSeedAudit({
      ...baseInput(),
      expectedCountries: ["AA"],
      coverageCounts: {
        corporateSectors: { AA: 1 }, // no B1 finding
        unions: {}, // B3-unions, medium
      },
      budgetSnapshotSeries: {
        AA: {
          turn: [1, 50, 100, 150],
          gdp: [100, 110, 120, 130],
          debtToGdp: [0.3, 0, 0, 0], // D2-bound-zero, critical
          spendTotal: [10, 20, 30, 40],
        },
      },
    });
    const severities = result.findings.map((f) => f.severity);
    const firstMediumIdx = severities.indexOf("medium");
    const lastCriticalIdx = severities.lastIndexOf("critical");
    if (firstMediumIdx !== -1 && lastCriticalIdx !== -1) {
      expect(lastCriticalIdx).toBeLessThan(firstMediumIdx);
    }
    expect(severities).toContain("critical");
    expect(severities).toContain("medium");
  });
});
