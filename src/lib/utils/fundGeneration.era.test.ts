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
import { eraPriceLevelFor, resolveCampaignPriceLevel } from "@/lib/campaigns/rules/priceLevel";
import { states1953 } from "@/lib/seeds/reference/states1953";
import type { OfficeType } from "@/lib/db/types";

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

// ── Era price level (issue #2119) ────────────────────────────────────────────
// Income takes a trailing/scalar `priceLevel` resolved at the shell from
// `gameConfig.campaignEraPriceLevelEnabled` + `gameState.preset`. These tests
// prove the gate is a no-op when off and that flag-on deflates a 1953 income
// stream by the same era value the cost math uses, while preserving the #798
// within-era regional variance.
describe("era price level scales income (issue #2119)", () => {
  // JP 1953-neutral region: per-capita == the 1953 JP baseline (277), so the
  // within-era GDP scalar is exactly 1 and any movement is the price level.
  const neutralJp1953 = {
    population: 5_000_000,
    donorBaseLevel: 0,
    currentOffice: null,
    stateGdpMillions: (277 * 5_000_000) / 1_000_000,
    countryId: "JP",
    politicalInfluence: 0,
  } as const;

  it("flag off (scalar 1) is byte-identical to the omitted-scalar projection", () => {
    expect(resolveCampaignPriceLevel(false, "1953-default")).toBe(1);
    expect(
      projectCharacterGeneration({ ...neutralJp1953, preset: "1953-default", priceLevel: 1 })
    ).toBe(projectCharacterGeneration({ ...neutralJp1953, preset: "1953-default" }));
    expect(
      calculateFullFundDistribution(
        5_000_000,
        10,
        null,
        10,
        5,
        (277 * 5_000_000) / 1_000_000,
        "JP",
        0,
        "1953-default",
        1
      )
    ).toEqual(
      calculateFullFundDistribution(
        5_000_000,
        10,
        null,
        10,
        5,
        (277 * 5_000_000) / 1_000_000,
        "JP",
        0,
        "1953-default"
      )
    );
    expect(
      getTotalFundGeneration(
        5_000_000,
        10,
        null,
        (277 * 5_000_000) / 1_000_000,
        "JP",
        0,
        "1953-default",
        1
      )
    ).toBe(
      getTotalFundGeneration(
        5_000_000,
        10,
        null,
        (277 * 5_000_000) / 1_000_000,
        "JP",
        0,
        "1953-default"
      )
    );
  });

  it("flag on deflates a 1953 income stream by the era price level", () => {
    const scalar = resolveCampaignPriceLevel(true, "1953-default");
    expect(scalar).toBe(eraPriceLevelFor("1953-default"));
    const modern = projectCharacterGeneration({ ...neutralJp1953, preset: "1953-default" });
    const era = projectCharacterGeneration({
      ...neutralJp1953,
      preset: "1953-default",
      priceLevel: scalar,
    });
    // Medium population tier base = 10,000/hr, gdpScalar 1, no donor/office legs.
    expect(modern).toBe(10_000);
    expect(era).toBe(Math.round(10_000 * scalar));
    expect(era).toBeLessThan(modern);
  });

  it("flag on also deflates the flat office bonus (every nominal leg scales)", () => {
    const scalar = resolveCampaignPriceLevel(true, "1953-default");
    const office = { type: "house" } as OfficeType;
    const modern = projectCharacterGeneration({
      ...neutralJp1953,
      currentOffice: office,
      preset: "1953-default",
    });
    const era = projectCharacterGeneration({
      ...neutralJp1953,
      currentOffice: office,
      preset: "1953-default",
      priceLevel: scalar,
    });
    // 10,000 base + 5,000 office; both nominal legs deflate by the same scalar.
    expect(modern).toBe(15_000);
    expect(era).toBe(Math.round(10_000 * scalar) + Math.round(5_000 * scalar));
  });

  it("2019 income is unchanged with the flag on", () => {
    const scalar = resolveCampaignPriceLevel(true, "2019-default");
    expect(scalar).toBe(1);
    const modern = {
      ...neutralJp1953,
      countryId: "US",
      stateGdpMillions: (69_618 * 5_000_000) / 1_000_000,
      preset: "2019-default",
    } as const;
    expect(projectCharacterGeneration({ ...modern, priceLevel: scalar })).toBe(
      projectCharacterGeneration({ ...modern })
    );
  });

  it("keeps >0 regional scalar variance within an era (issue #798 preserved)", () => {
    // A uniform era price level cannot flatten within-era differentiation: the
    // per-region GDP scalar is untouched, so the spread stays non-zero.
    const scalars = states1953
      .filter((s) => (s.gdp ?? 0) > 0 && s.population > 0)
      .map((s) => getIncomeGdpScalar(s.gdp as number, s.population, "US", "1953-default"));
    expect(scalars.length).toBeGreaterThan(1);
    const mean = scalars.reduce((a, b) => a + b, 0) / scalars.length;
    const variance = scalars.reduce((a, b) => a + (b - mean) ** 2, 0) / scalars.length;
    expect(variance).toBeGreaterThan(0);
    expect(Math.max(...scalars) - Math.min(...scalars)).toBeGreaterThan(0);
  });
});
