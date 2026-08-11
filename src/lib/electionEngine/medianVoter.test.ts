import { describe, expect, it } from "vitest";
import { computeMedianVoter, computeNationalEvWeightedMedian } from "./medianVoter";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";

function makeCategories(): DemographicCategory[] {
  return [
    {
      _id: "income",
      name: "Income",
      defaultWeight: 50,
      groups: [
        {
          id: "low",
          name: "Low income",
          defaultEconomicLean: -1,
          defaultSocialLean: 0,
          defaultTurnout: 60,
        },
        {
          id: "high",
          name: "High income",
          defaultEconomicLean: 1,
          defaultSocialLean: 0,
          defaultTurnout: 60,
        },
      ],
    } as unknown as DemographicCategory,
    {
      _id: "social",
      name: "Social",
      defaultWeight: 50,
      groups: [
        {
          id: "prog",
          name: "Progressive",
          defaultEconomicLean: 0,
          defaultSocialLean: -1,
          defaultTurnout: 60,
        },
        {
          id: "trad",
          name: "Traditional",
          defaultEconomicLean: 0,
          defaultSocialLean: 1,
          defaultTurnout: 60,
        },
      ],
    } as unknown as DemographicCategory,
  ];
}

function makeDemographics(overrides: Partial<StateDemographics["groups"]> = {}): StateDemographics {
  return {
    _id: "ST",
    countryId: "US",
    categoryWeights: { income: 50, social: 50 },
    groups: {
      low: { population: 50, turnout: 60, economicLean: -1, socialLean: 0 },
      high: { population: 50, turnout: 60, economicLean: 1, socialLean: 0 },
      prog: { population: 50, turnout: 60, economicLean: 0, socialLean: -1 },
      trad: { population: 50, turnout: 60, economicLean: 0, socialLean: 1 },
      ...overrides,
    },
    lastUpdated: new Date(),
  } as StateDemographics;
}

describe("computeMedianVoter", () => {
  it("returns (0, 0) for mirror-symmetric demographics", () => {
    const out = computeMedianVoter(makeDemographics(), makeCategories());
    expect(out.ep).toBeCloseTo(0);
    expect(out.sp).toBeCloseTo(0);
  });

  it("returns positive EP + SP for right-leaning demographics (population shift)", () => {
    // Shift the high-income / traditional groups up to 80% population each.
    const demo = makeDemographics({
      low: { population: 20, turnout: 60, economicLean: -1, socialLean: 0 },
      high: { population: 80, turnout: 60, economicLean: 1, socialLean: 0 },
      prog: { population: 20, turnout: 60, economicLean: 0, socialLean: -1 },
      trad: { population: 80, turnout: 60, economicLean: 0, socialLean: 1 },
    });
    const out = computeMedianVoter(demo, makeCategories());
    expect(out.ep).toBeGreaterThan(0);
    expect(out.sp).toBeGreaterThan(0);
  });

  it("returns negative EP + SP for left-leaning demographics", () => {
    const demo = makeDemographics({
      low: { population: 80, turnout: 60, economicLean: -1, socialLean: 0 },
      high: { population: 20, turnout: 60, economicLean: 1, socialLean: 0 },
      prog: { population: 80, turnout: 60, economicLean: 0, socialLean: -1 },
      trad: { population: 20, turnout: 60, economicLean: 0, socialLean: 1 },
    });
    const out = computeMedianVoter(demo, makeCategories());
    expect(out.ep).toBeLessThan(0);
    expect(out.sp).toBeLessThan(0);
  });

  it("liveTurnouts shift the median toward boosted groups", () => {
    // Symmetric population/lean BUT progressives turn out at 90% while
    // traditionals stay at 30% — the median should shift left socially.
    const demo = makeDemographics();
    const categories = makeCategories();
    const baseline = computeMedianVoter(demo, categories);
    const shifted = computeMedianVoter(demo, categories, {
      prog: 90,
      trad: 30,
      low: 60,
      high: 60,
    });
    expect(baseline.sp).toBeCloseTo(0);
    expect(shifted.sp).toBeLessThan(0); // progressives outweighed
    // Economic lean shouldn't shift — only the social-turnout asymmetry.
    expect(shifted.ep).toBeCloseTo(0);
  });

  it("returns (0, 0) when categoryWeights are all zero (empty mix)", () => {
    const demo = makeDemographics();
    demo.categoryWeights = { income: 0, social: 0 };
    const out = computeMedianVoter(demo, makeCategories());
    expect(out.ep).toBe(0);
    expect(out.sp).toBe(0);
  });

  it("ignores categories with zero population in all groups", () => {
    // Income groups populated, social groups empty. Result reflects
    // only income (which is mirror-symmetric → (0, 0)).
    const demo = makeDemographics({
      prog: { population: 0, turnout: 60, economicLean: 0, socialLean: -1 },
      trad: { population: 0, turnout: 60, economicLean: 0, socialLean: 1 },
    });
    const out = computeMedianVoter(demo, makeCategories());
    expect(out.ep).toBeCloseTo(0);
    expect(out.sp).toBeCloseTo(0);
  });

  it("falls back to category defaults when state-level lean is missing", () => {
    const demo = makeDemographics();
    // Strip the state-level leans from one group — should still read
    // defaultEconomicLean / defaultSocialLean from the category.
    demo.groups.high = { population: 50, turnout: 60 } as StateDemographics["groups"][string];
    const out = computeMedianVoter(demo, makeCategories());
    // Should still net to (0, 0) since defaults are the same as state leans.
    expect(out.ep).toBeCloseTo(0);
    expect(out.sp).toBeCloseTo(0);
  });
});

describe("computeNationalEvWeightedMedian", () => {
  function rightLeaning(): StateDemographics {
    return {
      ...makeDemographics({
        low: { population: 20, turnout: 60, economicLean: -1, socialLean: 0 },
        high: { population: 80, turnout: 60, economicLean: 1, socialLean: 0 },
        prog: { population: 20, turnout: 60, economicLean: 0, socialLean: -1 },
        trad: { population: 80, turnout: 60, economicLean: 0, socialLean: 1 },
      }),
      _id: "R",
    };
  }
  function leftLeaning(): StateDemographics {
    return {
      ...makeDemographics({
        low: { population: 80, turnout: 60, economicLean: -1, socialLean: 0 },
        high: { population: 20, turnout: 60, economicLean: 1, socialLean: 0 },
        prog: { population: 80, turnout: 60, economicLean: 0, socialLean: -1 },
        trad: { population: 20, turnout: 60, economicLean: 0, socialLean: 1 },
      }),
      _id: "L",
    };
  }

  it("returns (0, 0) when the EV-weighted blend cancels out", () => {
    // Equal EV on left + right leaning states → symmetric cancel.
    const out = computeNationalEvWeightedMedian(
      [
        { demographics: leftLeaning(), ev: 10 },
        { demographics: rightLeaning(), ev: 10 },
      ],
      makeCategories()
    );
    expect(out.ep).toBeCloseTo(0);
    expect(out.sp).toBeCloseTo(0);
  });

  it("pulls toward the high-EV state", () => {
    // 50-EV right-leaning state vs 3-EV left-leaning state → net rightward.
    const out = computeNationalEvWeightedMedian(
      [
        { demographics: leftLeaning(), ev: 3 },
        { demographics: rightLeaning(), ev: 50 },
      ],
      makeCategories()
    );
    expect(out.ep).toBeGreaterThan(0);
    expect(out.sp).toBeGreaterThan(0);
  });

  it("returns (0, 0) for empty input", () => {
    const out = computeNationalEvWeightedMedian([], makeCategories());
    expect(out.ep).toBe(0);
    expect(out.sp).toBe(0);
  });

  it("ignores entries with non-positive EV", () => {
    // The 0-EV entry is dropped; only the right-leaning state counts.
    const out = computeNationalEvWeightedMedian(
      [
        { demographics: leftLeaning(), ev: 0 },
        { demographics: rightLeaning(), ev: 10 },
      ],
      makeCategories()
    );
    expect(out.ep).toBeGreaterThan(0);
    expect(out.sp).toBeGreaterThan(0);
  });

  it("forwards liveTurnouts to per-state median computation", () => {
    // Symmetric population, but boosting one side's social-progressive
    // turnout in one state shifts that state's median — and the national
    // EV-weighted blend inherits that shift.
    const demo = makeDemographics();
    const out = computeNationalEvWeightedMedian(
      [
        {
          demographics: demo,
          liveTurnouts: { prog: 90, trad: 30, low: 60, high: 60 },
          ev: 10,
        },
      ],
      makeCategories()
    );
    expect(out.sp).toBeLessThan(0);
  });
});
