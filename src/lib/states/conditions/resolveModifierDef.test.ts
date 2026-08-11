import { describe, expect, it } from "vitest";
import { resolveModifierDef } from "./resolveModifierDef";

describe("resolveModifierDef", () => {
  const base = {
    id: "high_poverty",
    label: "High Poverty Rate",
    effect: -1,
    conditions: [{ category: "economic", metric: "povertyRate", op: ">=" as const, value: 15 }],
  };

  it("applies UK poverty threshold patch", () => {
    const resolved = resolveModifierDef(base, { countryId: "UK" });
    expect(resolved?.conditions[0].value).toBe(20);
  });

  it("leaves modern US thresholds unchanged", () => {
    const resolved = resolveModifierDef(base, { countryId: "US", preset: "2019-default" });
    expect(resolved?.conditions[0].value).toBe(15);
  });

  it("suppresses broadband modifiers in 1991", () => {
    const resolved = resolveModifierDef(
      {
        id: "high_broadband",
        label: "High Broadband Access",
        effect: 1,
        conditions: [
          { category: "infrastructure", metric: "broadbandAccess", op: ">=", value: 90 },
        ],
      },
      { preset: "1991-default" }
    );
    expect(resolved).toBeNull();
  });

  it("applies country-era1991 patch after country and era layers", () => {
    const resolved = resolveModifierDef(
      {
        id: "research_hub",
        label: "Research Hub",
        effect: 1,
        conditions: [{ category: "economic", metric: "rdIntensity", op: ">=", value: 3.2 }],
      },
      { preset: "1991-default", countryId: "UK" }
    );
    expect(resolved).toBeNull();
  });

  it("suppresses JP life-expectancy badges with flat national seeds", () => {
    const resolved = resolveModifierDef(
      {
        id: "longevity",
        label: "Healthy Longevity",
        effect: 1,
        conditions: [
          { category: "healthcare", metric: "lifeExpectancy", op: ">=", value: 82 },
          { category: "healthcare", metric: "preventableMortality", op: "<=", value: 280 },
        ],
      },
      { countryId: "JP", preset: "2019-default" }
    );
    expect(resolved).toBeNull();
  });
});
