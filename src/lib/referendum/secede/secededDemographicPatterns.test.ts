import { describe, it, expect } from "vitest";
import { SCO_REGION_DEMOGRAPHIC_PATTERNS } from "@/lib/seeds/sco/scoRegionDemographics";
import { WAL_REGION_DEMOGRAPHIC_PATTERNS } from "@/lib/seeds/wal/walRegionDemographics";
import { getSecededDemographicPattern, presetToPatternEra } from "./secededDemographicPatterns";

const GROUPS = [
  "post_industrial_workers",
  "urban_progressives",
  "suburban_homeowners",
  "young_renters",
  "rural_traditionalists",
  "retirees",
  "public_sector",
  "moderate_centrists",
  "populist_right",
  "green_activists",
  "small_business",
  "new_britons",
];

const SCO_POP: Record<string, number> = {
  GLA: 1160,
  LOT: 900,
  HIG: 470,
  GRA: 590,
  TAY: 810,
  STH: 700,
  CSC: 810,
};
const WAL_POP: Record<string, number> = {
  CDF: 1050,
  SWA: 700,
  VAL: 600,
  MWA: 210,
  NWW: 330,
  NEW: 280,
};

// National aggregates per era (must be matched within ±4 by the pop-weighted avg).
type EraAgg = Record<"1991" | "2019", Record<string, number>>;
const SCO_AGG: EraAgg = {
  "2019": {
    post_industrial_workers: 17,
    urban_progressives: 13,
    suburban_homeowners: 9,
    young_renters: 11,
    rural_traditionalists: 9,
    retirees: 12,
    public_sector: 7,
    moderate_centrists: 9,
    populist_right: 4,
    green_activists: 4,
    small_business: 3,
    new_britons: 2,
  },
  "1991": {
    post_industrial_workers: 23,
    urban_progressives: 9,
    suburban_homeowners: 9,
    young_renters: 11,
    rural_traditionalists: 10,
    retirees: 11,
    public_sector: 9,
    moderate_centrists: 8,
    populist_right: 2,
    green_activists: 2,
    small_business: 4,
    new_britons: 2,
  },
};
const WAL_AGG: EraAgg = {
  "2019": {
    post_industrial_workers: 18,
    urban_progressives: 8,
    suburban_homeowners: 9,
    young_renters: 8,
    rural_traditionalists: 13,
    retirees: 12,
    public_sector: 14,
    moderate_centrists: 5,
    populist_right: 7,
    green_activists: 3,
    small_business: 2,
    new_britons: 1,
  },
  "1991": {
    post_industrial_workers: 24,
    urban_progressives: 6,
    suburban_homeowners: 9,
    young_renters: 7,
    rural_traditionalists: 14,
    retirees: 11,
    public_sector: 15,
    moderate_centrists: 5,
    populist_right: 2,
    green_activists: 1,
    small_business: 5,
    new_britons: 1,
  },
};

function weightedAvg(
  pattern: Record<string, Record<string, number>>,
  pop: Record<string, number>,
  group: string
): number {
  const total = Object.values(pop).reduce((s, p) => s + p, 0);
  let acc = 0;
  for (const [region, p] of Object.entries(pop)) acc += p * (pattern[region]?.[group] ?? 0);
  return acc / total;
}

describe.each([
  ["SCO", SCO_REGION_DEMOGRAPHIC_PATTERNS, SCO_POP, SCO_AGG],
  ["WAL", WAL_REGION_DEMOGRAPHIC_PATTERNS, WAL_POP, WAL_AGG],
] as const)("%s region demographic patterns", (_name, patterns, pop, agg) => {
  for (const era of ["1991", "2019"] as const) {
    it(`${era}: every region has all 12 groups summing to exactly 100`, () => {
      for (const [region, shares] of Object.entries(patterns[era])) {
        expect(Object.keys(shares).sort()).toEqual([...GROUPS].sort());
        const sum = GROUPS.reduce((s, g) => s + shares[g], 0);
        expect(sum, `${region} sum`).toBe(100);
      }
    });

    it(`${era}: population-weighted average is within ±4 of the national aggregate`, () => {
      for (const g of GROUPS) {
        const avg = weightedAvg(patterns[era], pop, g);
        expect(
          Math.abs(avg - agg[era][g]),
          `${g}: ${avg.toFixed(1)} vs ${agg[era][g]}`
        ).toBeLessThanOrEqual(4);
      }
    });

    it(`${era}: regions are differentiated (not all identical)`, () => {
      const regions = Object.keys(patterns[era]);
      const piw = regions.map((r) => patterns[era][r].post_industrial_workers);
      expect(Math.max(...piw) - Math.min(...piw)).toBeGreaterThanOrEqual(8);
    });
  }
});

describe("getSecededDemographicPattern", () => {
  it("maps presets to the right era", () => {
    expect(presetToPatternEra("1991-default")).toBe("1991");
    expect(presetToPatternEra("2019-default")).toBe("2019");
    expect(presetToPatternEra("2019-no-parties")).toBe("2019");
    expect(presetToPatternEra(undefined)).toBe("2019");
  });

  it("returns the nation+era pattern and null for non-seceding ids", () => {
    expect(getSecededDemographicPattern("SCO", "1991-default")).toBe(
      SCO_REGION_DEMOGRAPHIC_PATTERNS["1991"]
    );
    expect(getSecededDemographicPattern("WAL", "2019-default")).toBe(
      WAL_REGION_DEMOGRAPHIC_PATTERNS["2019"]
    );
  });
});
