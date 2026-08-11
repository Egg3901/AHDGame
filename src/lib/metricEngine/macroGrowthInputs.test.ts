import { describe, expect, it } from "vitest";
import { buildMacroGrowthInputs, type CountryMacroRaw } from "./macroGrowthInputs";
import { opennessGate, econSystemFactor, tradeFactor, freedomFactor } from "./convergence";

const row = (o: Partial<CountryMacroRaw> & { countryId: string }): CountryMacroRaw => ({
  gdpLocalMillions: 1_000_000,
  population: 100_000_000,
  fxLocalPerAnchor: 1,
  ...o,
});

describe("buildMacroGrowthInputs", () => {
  it("anchor-normalizes per-capita via FX (local/fx)", () => {
    const out = buildMacroGrowthInputs([
      row({ countryId: "US", gdpLocalMillions: 1_000_000, fxLocalPerAnchor: 1 }),
      row({ countryId: "JP", gdpLocalMillions: 5_000_000, fxLocalPerAnchor: 100 }),
    ]);
    expect(out.byCountry.get("US")!.ownPcAnchor).toBeCloseTo(10_000, 0);
    expect(out.byCountry.get("JP")!.ownPcAnchor).toBeCloseTo(500, 0);
  });

  it("frontier is the max anchor per-capita across countries", () => {
    const out = buildMacroGrowthInputs([
      row({ countryId: "US", gdpLocalMillions: 1_000_000, fxLocalPerAnchor: 1 }),
      row({ countryId: "JP", gdpLocalMillions: 5_000_000, fxLocalPerAnchor: 100 }),
    ]);
    expect(out.frontierPcAnchor).toBeCloseTo(10_000, 0);
  });

  it("openness combines the three factors per country", () => {
    const out = buildMacroGrowthInputs([
      row({ countryId: "CN", soci: 0.4, tradeGrowth: 18, economicFreedom: 40 }),
    ]);
    const expected = opennessGate({
      econSystem: econSystemFactor(0.4),
      trade: tradeFactor(18),
      freedom: freedomFactor(40),
    });
    expect(out.byCountry.get("CN")!.openness).toBeCloseTo(expected, 4);
  });

  it("a country with zero population is skipped (no NaN pc, not the frontier)", () => {
    const out = buildMacroGrowthInputs([
      row({ countryId: "US", gdpLocalMillions: 1_000_000, population: 100_000_000 }),
      row({ countryId: "XX", gdpLocalMillions: 1_000_000, population: 0 }),
    ]);
    expect(out.byCountry.has("XX")).toBe(false);
    expect(Number.isFinite(out.frontierPcAnchor)).toBe(true);
  });

  it("missing FX (≤0) treated as 1 (pre-forex passthrough)", () => {
    const out = buildMacroGrowthInputs([
      row({ countryId: "US", gdpLocalMillions: 1_000_000, fxLocalPerAnchor: 0 }),
    ]);
    expect(out.byCountry.get("US")!.ownPcAnchor).toBeCloseTo(10_000, 0);
  });
});
