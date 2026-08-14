import { describe, it, expect } from "vitest";
import { buildRiskReadout, RUN_FAILURE_COVER_FRACTION, bandFor } from "./riskReadout";

const base = {
  cashReserves: 1_000_000,
  cashBackedDeposits: 1_000_000,
  totalLoans: 500_000,
  reserveRatioRequired: 0.2,
  confidence: 1,
  band: "green" as const,
};

describe("buildRiskReadout", () => {
  it("marks the line a run actually fails at, not the requirement", () => {
    const r = buildRiskReadout(base);
    expect(r.requiredReserves).toBe(200_000);
    expect(r.runFailureThreshold).toBe(RUN_FAILURE_COVER_FRACTION * 200_000);
    expect(r.headroomToFailure).toBe(1_000_000 - 100_000);
  });

  it("decomposes confidence into terms that sum to the weights", () => {
    const r = buildRiskReadout(base);
    const totalMax = r.terms.reduce((s, t) => s + t.max, 0);
    expect(totalMax).toBeCloseTo(1, 9);
    for (const t of r.terms) expect(t.contribution).toBeLessThanOrEqual(t.max + 1e-9);
  });

  it("names reserve cover as the drag when the bank holds no cash", () => {
    // The exact shape that killed every bank before deposits carried cash:
    // asset quality is the only term paying out.
    const r = buildRiskReadout({ ...base, cashReserves: 0, confidence: 0.3, band: "red" });
    const reserves = r.terms.find((t) => t.key === "reserves")!;
    const quality = r.terms.find((t) => t.key === "assetQuality")!;
    expect(reserves.contribution).toBe(0);
    expect(quality.contribution).toBeGreaterThan(0.29);
  });

  it("warns while the band is the ONLY thing holding failure off", () => {
    // Cash already under the run line, but the published band is not yet red,
    // which is precisely the turn a player can still act on.
    const r = buildRiskReadout({
      ...base,
      cashReserves: 50_000,
      confidence: 0.5,
      band: "amber",
    });
    expect(r.oneBandFromFailure).toBe(true);
    expect(r.verdict).toMatch(/one band from failure/i);
  });

  it("does not cry wolf when cash is under the requirement but above the run line", () => {
    const r = buildRiskReadout({ ...base, cashReserves: 150_000, band: "amber", confidence: 0.5 });
    expect(r.oneBandFromFailure).toBe(false);
    expect(r.verdict).toMatch(/amber/i);
  });

  it("says so plainly when the bank is failing right now", () => {
    const r = buildRiskReadout({ ...base, cashReserves: 10_000, band: "red", confidence: 0.2 });
    expect(r.verdict).toMatch(/failing/i);
  });

  it("treats a bank with no deposits as fully covered rather than dividing by zero", () => {
    const r = buildRiskReadout({ ...base, cashBackedDeposits: 0, totalLoans: 0 });
    expect(Number.isFinite(r.reserveCoverRatio)).toBe(true);
    expect(r.reserveCoverRatio).toBe(1);
    expect(r.requiredReserves).toBe(0);
  });

  it("survives malformed figures without producing NaN", () => {
    const r = buildRiskReadout({
      ...base,
      cashReserves: Number.NaN,
      cashBackedDeposits: -5,
      totalLoans: Number.NaN,
    });
    expect(Number.isFinite(r.reserveCoverRatio)).toBe(true);
    expect(Number.isFinite(r.headroomToFailure)).toBe(true);
    for (const t of r.terms) expect(Number.isFinite(t.contribution)).toBe(true);
  });
});

describe("bandFor", () => {
  it("matches the thresholds the solvency pass keys on", () => {
    expect(bandFor(0.7)).toBe("green");
    expect(bandFor(0.69)).toBe("amber");
    expect(bandFor(0.4)).toBe("amber");
    expect(bandFor(0.39)).toBe("red");
  });
});
