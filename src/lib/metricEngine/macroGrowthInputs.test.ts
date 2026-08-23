import { describe, expect, it } from "vitest";
import { buildMacroGrowthInputs, type CountryMacroRaw } from "./macroGrowthInputs";
import { developmentGate } from "./convergence";

const row = (o: Partial<CountryMacroRaw> & { countryId: string }): CountryMacroRaw => ({
  gdpLocalMillions: 1_000_000,
  population: 100_000_000,
  ...o,
});

describe("buildMacroGrowthInputs", () => {
  it("anchor-normalizes per-capita via the era GDP denomination, not market FX", () => {
    const out = buildMacroGrowthInputs(
      [
        row({ countryId: "US", gdpLocalMillions: 1_000_000 }),
        // At the 1953 GDP anchor, GBP 357k millions is A1m millions.
        row({ countryId: "UK", gdpLocalMillions: 357_000 }),
      ],
      "1953-default"
    );
    expect(out.byCountry.get("US")!.ownPcAnchor).toBeCloseTo(10_000, 0);
    expect(out.byCountry.get("UK")!.ownPcAnchor).toBeCloseTo(10_000, 0);
  });

  it("frontier is the max anchor per-capita across countries", () => {
    const out = buildMacroGrowthInputs(
      [
        row({ countryId: "US", gdpLocalMillions: 1_000_000 }),
        row({ countryId: "UK", gdpLocalMillions: 178_500 }),
      ],
      "1953-default"
    );
    expect(out.frontierPcAnchor).toBeCloseTo(10_000, 0);
  });

  it("uses the stronger valid development path per country", () => {
    const input = row({
      countryId: "RU",
      soci: 85,
      tradeGrowth: 2.5,
      economicFreedom: 10,
      industrialPolicyExecution: 0.8,
      workforceSkill: 75,
      transportEfficiency: 70,
      publicInvestmentEffort: 0.8,
    });
    const out = buildMacroGrowthInputs([input], "1953-default");
    expect(out.byCountry.get("RU")!.openness).toBeCloseTo(developmentGate(input), 4);
  });

  it("a country with zero population is skipped", () => {
    const out = buildMacroGrowthInputs(
      [
        row({ countryId: "US", gdpLocalMillions: 1_000_000, population: 100_000_000 }),
        row({ countryId: "XX", gdpLocalMillions: 1_000_000, population: 0 }),
      ],
      "1953-default"
    );
    expect(out.byCountry.has("XX")).toBe(false);
    expect(Number.isFinite(out.frontierPcAnchor)).toBe(true);
  });

  it("anchor-denominated GDP remains passthrough", () => {
    const out = buildMacroGrowthInputs(
      [row({ countryId: "US", gdpLocalMillions: 1_000_000 })],
      "1953-default"
    );
    expect(out.byCountry.get("US")!.ownPcAnchor).toBeCloseTo(10_000, 0);
  });

  it("excludes coming-soon countries from the active frontier", () => {
    const out = buildMacroGrowthInputs(
      [
        row({ countryId: "US", gdpLocalMillions: 1_000_000 }),
        row({ countryId: "UK", gdpLocalMillions: 178_500 }),
        row({ countryId: "BR", gdpLocalMillions: 9_000_000 }),
      ],
      "1953-default",
      new Set(["US", "UK"])
    );
    expect(out.byCountry.has("BR")).toBe(false);
    expect(out.frontierPcAnchor).toBeCloseTo(10_000, 0);
  });
});
