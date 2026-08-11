import { describe, expect, it } from "vitest";
import { deriveEconomicOutlook } from "./outlook";

describe("deriveEconomicOutlook", () => {
  it("is CONTRACTING when GDP growth is negative", () => {
    const result = deriveEconomicOutlook({
      gdpGrowth: -0.8,
      inflation: 1.5,
      inflationTarget: 2,
      unemploymentTrend: 1.2,
    });
    expect(result?.verdict).toBe("CONTRACTING");
  });

  it("is OVERHEATING when inflation runs far above target while the economy grows", () => {
    const result = deriveEconomicOutlook({
      gdpGrowth: 3.5,
      inflation: 5.4,
      inflationTarget: 2,
      unemploymentTrend: -0.2,
    });
    expect(result?.verdict).toBe("OVERHEATING");
  });

  it("is EXPANDING when growth is well above trend with contained prices", () => {
    const result = deriveEconomicOutlook({
      gdpGrowth: 3.4,
      inflation: 2.3,
      inflationTarget: 2,
      unemploymentTrend: 0.1,
    });
    expect(result?.verdict).toBe("EXPANDING");
  });

  it("is STEADY when growth sits near trend", () => {
    const result = deriveEconomicOutlook({
      gdpGrowth: 1.9,
      inflation: 3.4,
      inflationTarget: 2,
      unemploymentTrend: -0.2,
    });
    expect(result?.verdict).toBe("STEADY");
  });

  it("is COOLING when growth is positive but well below trend", () => {
    const result = deriveEconomicOutlook({
      gdpGrowth: 0.4,
      inflation: 1.8,
      inflationTarget: 2,
      unemploymentTrend: 0.4,
    });
    expect(result?.verdict).toBe("COOLING");
  });

  it("contraction takes precedence over hot prices (stagflation reads CONTRACTING)", () => {
    const result = deriveEconomicOutlook({
      gdpGrowth: -1.2,
      inflation: 6.1,
      inflationTarget: 2,
      unemploymentTrend: 0.8,
    });
    expect(result?.verdict).toBe("CONTRACTING");
  });

  it("returns null when the hero indicators are missing", () => {
    expect(
      deriveEconomicOutlook({
        gdpGrowth: null,
        inflation: 2.0,
        inflationTarget: 2,
        unemploymentTrend: 0,
      })
    ).toBeNull();
    expect(
      deriveEconomicOutlook({
        gdpGrowth: 2.0,
        inflation: null,
        inflationTarget: 2,
        unemploymentTrend: 0,
      })
    ).toBeNull();
  });

  it("explains the verdict with growth, price, and labor clauses", () => {
    const result = deriveEconomicOutlook({
      gdpGrowth: 1.9,
      inflation: 3.4,
      inflationTarget: 2,
      unemploymentTrend: -0.2,
    });
    expect(result?.reasoning).toMatch(/growth/i);
    expect(result?.reasoning).toMatch(/\+1\.9%/);
    expect(result?.reasoning).toMatch(/3\.4%.*2(\.0)?% target/);
    expect(result?.reasoning).toMatch(/labor market improving/i);
    expect(result?.reasoning).toMatch(/nothing stored/i);
  });

  it("tolerates a missing unemployment trend without a labor clause", () => {
    const result = deriveEconomicOutlook({
      gdpGrowth: 2.0,
      inflation: 2.0,
      inflationTarget: 2,
      unemploymentTrend: null,
    });
    expect(result?.verdict).toBe("STEADY");
    expect(result?.reasoning).not.toMatch(/labor market/i);
  });
});
