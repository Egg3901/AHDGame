/**
 * Era-parameterized income tests (issue #798).
 *
 * Income math (`getIncomeGdpScalar`, `getTotalFundGeneration`,
 * `calculateFullFundDistribution`, `projectCharacterGeneration`) resolves its
 * GDP-per-capita baseline from the world preset. These tests pin the
 * cross-era behavior for JP and NG 1953, the unknown-country failure, and the
 * modern default for callers with no world to ask.
 */
import { describe, expect, it } from "vitest";
import {
  calculateFullFundDistribution,
  getIncomeGdpScalar,
  getTotalFundGeneration,
  projectCharacterGeneration,
} from "./fundGeneration";

describe("getIncomeGdpScalar era parameter (issue #798)", () => {
  it("is neutral for a 1953-scale JP region under its own era", () => {
    const pop = 10_000_000;
    const gdpMillions1953 = (277 * pop) / 1_000_000;
    expect(getIncomeGdpScalar(gdpMillions1953, pop, "JP", "1953-default")).toBeCloseTo(1.0);
  });

  it("floors the same 1953-scale JP region under the modern default", () => {
    const pop = 10_000_000;
    const gdpMillions1953 = (277 * pop) / 1_000_000;
    expect(getIncomeGdpScalar(gdpMillions1953, pop, "JP")).toBe(0.9);
    expect(getIncomeGdpScalar(gdpMillions1953, pop, "JP", "2019-default")).toBe(0.9);
  });

  it("is neutral for an average NG region in 1953, 1979, and 2019 eras", () => {
    const pop = 10_000_000;
    expect(getIncomeGdpScalar((113 * pop) / 1_000_000, pop, "NG", "1953-default")).toBeCloseTo(1.0);
    // Post-reconcile crush cell: 324 naira per-capita is the seeded average.
    expect(getIncomeGdpScalar((324 * pop) / 1_000_000, pop, "NG", "1979-default")).toBeCloseTo(1.0);
    expect(
      getIncomeGdpScalar((3_669_401 * pop) / 1_000_000, pop, "NG", "2019-default")
    ).toBeCloseTo(1.0);
  });

  it("throws for countries without an explicit baseline", () => {
    expect(() => getIncomeGdpScalar(100_000, 1_000_000, "XX")).toThrow(/no GDP baseline/);
    expect(() => getIncomeGdpScalar(100_000, 1_000_000, "CA", "2019-default")).toThrow(
      /no GDP baseline/
    );
  });
});

describe("fund totals era parameter (issue #798)", () => {
  it("prices a 1953-scale NG income above the modern-clamped total", () => {
    // Same 1953-scale region: neutral scalar under its era, 0.9 floor under
    // modern. Donor/office bonuses are flat, so the era moves the total.
    const pop = 5_000_000;
    const gdpMillions1953 = (113 * pop) / 1_000_000;
    const eraTotal = getTotalFundGeneration(pop, 0, null, gdpMillions1953, "NG", 0, "1953-default");
    const modernTotal = getTotalFundGeneration(pop, 0, null, gdpMillions1953, "NG");
    expect(eraTotal).toBeGreaterThan(modernTotal);
  });

  it("keeps distribution arithmetic consistent under a historical preset", () => {
    const pop = 5_000_000;
    const gdpMillions1953 = (277 * pop) / 1_000_000;
    const dist = calculateFullFundDistribution(
      pop,
      0,
      null,
      10,
      5,
      gdpMillions1953,
      "JP",
      0,
      "1953-default"
    );
    expect(dist.totalGeneration).toBe(dist.baseGeneration + dist.donorBaseBonus + dist.officeBonus);
    expect(dist.characterReceives).toBe(
      dist.totalGeneration - dist.stateTaxAmount - dist.nationalTaxAmount
    );
    expect(dist.characterReceives).toBeGreaterThan(0);
  });

  it("threads preset through projectCharacterGeneration with modern default", () => {
    const base = {
      population: 5_000_000,
      donorBaseLevel: 0,
      currentOffice: null,
      stateGdpMillions: (277 * 5_000_000) / 1_000_000,
      countryId: "JP",
      politicalInfluence: 0,
    } as const;
    expect(projectCharacterGeneration({ ...base, preset: "1953-default" })).toBeGreaterThan(
      projectCharacterGeneration({ ...base })
    );
    expect(projectCharacterGeneration({ ...base })).toBe(
      projectCharacterGeneration({ ...base, preset: "2019-default" })
    );
  });
});
