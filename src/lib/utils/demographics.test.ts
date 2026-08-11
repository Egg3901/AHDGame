import { describe, it, expect } from "vitest";
import {
  calculateStateLean,
  validateCategoryWeights,
  getLeanLabel,
  getSocialLeanLabel,
  getLeanColor,
  formatLeanValue,
} from "./demographics";
import type { StateDemographics, DemographicCategory, CategoryWeights } from "@/lib/db/types";

describe("calculateStateLean", () => {
  it("returns zeros for empty/invalid input", () => {
    expect(calculateStateLean(null as unknown as StateDemographics, [])).toEqual({
      economicLean: 0,
      socialLean: 0,
    });
    expect(
      calculateStateLean(
        {
          _id: "x",
          countryId: "US",
          categoryWeights: {} as CategoryWeights,
          groups: {},
          lastUpdated: new Date(),
        },
        []
      )
    ).toEqual({ economicLean: 0, socialLean: 0 });
  });

  it("computes lean from single category (turnout-weighted)", () => {
    const demographics: StateDemographics = {
      _id: "CA",
      countryId: "US",
      categoryWeights: { race: 100 },
      groups: {
        white: { population: 60, economicLean: 1, socialLean: 0.5 },
        black: { population: 40, economicLean: -0.5, socialLean: -0.3 },
      },
      lastUpdated: new Date(),
    };
    const categories: DemographicCategory[] = [
      {
        _id: "race",
        name: "Race",
        defaultWeight: 100,
        groups: [
          {
            id: "white",
            name: "White",
            defaultEconomicLean: 0,
            defaultSocialLean: 0,
            defaultTurnout: 60,
          },
          {
            id: "black",
            name: "Black",
            defaultEconomicLean: 0,
            defaultSocialLean: 0,
            defaultTurnout: 40,
          },
        ],
      },
    ];
    const result = calculateStateLean(demographics, categories);
    // Weight = pop × turnout: white 60×60=3600, black 40×40=1600. Total 5200.
    // Raw econ: (3600×1 + 1600×(-0.5))/5200 = 2800/5200 ≈ 0.54
    // Raw soc: (3600×0.5 + 1600×(-0.3))/5200 = 1320/5200 ≈ 0.25
    expect(result.economicLean).toBeCloseTo(0.54, 1);
    expect(result.socialLean).toBeCloseTo(0.25, 1);
  });

  it("clamps result to -5..+5 range", () => {
    const demographics: StateDemographics = {
      _id: "X",
      countryId: "US",
      categoryWeights: { race: 100 },
      groups: { a: { population: 100, economicLean: 2, socialLean: 2 } },
      lastUpdated: new Date(),
    };
    const categories: DemographicCategory[] = [
      {
        _id: "race",
        name: "Race",
        defaultWeight: 100,
        groups: [
          { id: "a", name: "A", defaultEconomicLean: 0, defaultSocialLean: 0, defaultTurnout: 50 },
        ],
      },
    ];
    const result = calculateStateLean(demographics, categories);
    expect(result.economicLean).toBeLessThanOrEqual(5);
    expect(result.economicLean).toBeGreaterThanOrEqual(-5);
    expect(result.socialLean).toBeLessThanOrEqual(5);
    expect(result.socialLean).toBeGreaterThanOrEqual(-5);
  });

  it("ignores categories absent from categoryWeights (no defaultWeight fallback)", () => {
    // Only `race` is weighted. A second category (`foreign`, not in
    // categoryWeights — e.g. another country's voter-group category) must NOT
    // contribute via its defaultWeight, or it would pollute the lean. Matches
    // computeMedianVoter, which only counts explicitly-weighted categories.
    const demographics: StateDemographics = {
      _id: "CA",
      countryId: "US",
      categoryWeights: { race: 100 },
      groups: {
        white: { population: 100, economicLean: 1, socialLean: 1 },
        // group referenced only by the unweighted `foreign` category:
        foreignGroup: { population: 100, economicLean: -5, socialLean: -5 },
      },
      lastUpdated: new Date(),
    };
    const categories: DemographicCategory[] = [
      {
        _id: "race",
        name: "Race",
        defaultWeight: 100,
        groups: [
          {
            id: "white",
            name: "White",
            defaultEconomicLean: 0,
            defaultSocialLean: 0,
            defaultTurnout: 50,
          },
        ],
      },
      {
        _id: "foreign",
        name: "Foreign voter groups",
        defaultWeight: 100,
        groups: [
          {
            id: "foreignGroup",
            name: "FG",
            defaultEconomicLean: 0,
            defaultSocialLean: 0,
            defaultTurnout: 50,
          },
        ],
      },
    ];
    const result = calculateStateLean(demographics, categories);
    // Only `white` (the weighted `race` category) counts → +1 / +1, NOT dragged
    // toward −5 by the unweighted foreign category.
    expect(result.economicLean).toBeCloseTo(1);
    expect(result.socialLean).toBeCloseTo(1);
  });
});

describe("validateCategoryWeights", () => {
  it("returns true when sum is 100", () => {
    expect(
      validateCategoryWeights({
        race: 20,
        gender: 15,
        education: 20,
        wealth: 15,
        age: 15,
        ideology: 15,
      })
    ).toBe(true);
  });

  it("returns false when sum is not 100", () => {
    expect(
      validateCategoryWeights({
        race: 20,
        gender: 20,
        education: 20,
        wealth: 20,
        age: 20,
        ideology: 20,
      })
    ).toBe(false);
  });

  it("accepts voterGroups weight 100 (12 archetypes)", () => {
    expect(validateCategoryWeights({ voterGroups: 100 })).toBe(true);
  });
});

describe("getLeanLabel", () => {
  it("uses the shared candidate-scale ruler (0.5 buckets)", () => {
    // Region leans now read on the same ruler candidates use: a mild -0.76
    // median is "Center-Left", not the old over-dramatised "Lean Left".
    expect(getLeanLabel(-1.2)).toBe("Center-Left"); // bucket -1
    expect(getLeanLabel(-0.76)).toBe("Center-Left"); // bucket -1
    expect(getLeanLabel(0)).toBe("Centrist");
    expect(getLeanLabel(0.5)).toBe("Center-Right"); // bucket +1 (0.5 rounds out)
    expect(getLeanLabel(2.06)).toBe("Lean Right"); // bucket +2
    expect(getSocialLeanLabel(-0.66)).toBe("Center-Liberal");
  });
});

describe("getLeanColor", () => {
  it("returns correct color classes", () => {
    expect(getLeanColor(-2)).toBe("text-blue-400");
    expect(getLeanColor(2)).toBe("text-red-400");
    expect(getLeanColor(0)).toBe("text-purple-400");
  });
});

describe("formatLeanValue", () => {
  it("formats positive with plus sign", () => {
    expect(formatLeanValue(1.5)).toBe("+1.50");
  });
  it("formats negative without plus", () => {
    expect(formatLeanValue(-1.5)).toBe("-1.50");
  });
});
