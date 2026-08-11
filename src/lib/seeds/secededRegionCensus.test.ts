import { describe, it, expect } from "vitest";
import { scoRegionCensusData, scoRegionCensusData1991 } from "./sco/scoRegionCensusData";
import { walRegionCensusData, walRegionCensusData1991 } from "./wal/walRegionCensusData";

type Census = Record<string, Record<string, Record<string, number>>>;

const CATEGORIES: Record<string, string[]> = {
  ethnicity: ["white_british", "asian_british", "black_british", "mixed", "other"],
  age: ["young", "mid", "mature", "senior"],
  education: ["no_qualifications", "gcse_equivalent", "a_level_equivalent", "degree_plus"],
  income: ["low", "middle", "high"],
  urbanization: ["urban", "suburban", "rural"],
};

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
const AGG = {
  SCO2019: {
    ethnicity: { white_british: 93, asian_british: 4, black_british: 1, mixed: 1, other: 1 },
    age: { young: 17, mid: 25, mature: 30, senior: 28 },
    education: {
      no_qualifications: 9,
      gcse_equivalent: 24,
      a_level_equivalent: 28,
      degree_plus: 39,
    },
    income: { low: 24, middle: 51, high: 25 },
    urbanization: { urban: 68, suburban: 18, rural: 14 },
  },
  SCO1991: {
    ethnicity: { white_british: 98, asian_british: 1, black_british: 0, mixed: 1, other: 0 },
    age: { young: 20, mid: 23, mature: 33, senior: 24 },
    education: {
      no_qualifications: 38,
      gcse_equivalent: 28,
      a_level_equivalent: 19,
      degree_plus: 15,
    },
    income: { low: 28, middle: 53, high: 19 },
    urbanization: { urban: 50, suburban: 28, rural: 22 },
  },
  WAL2019: {
    ethnicity: { white_british: 93, asian_british: 3, black_british: 1, mixed: 2, other: 1 },
    age: { young: 16, mid: 23, mature: 30, senior: 31 },
    education: {
      no_qualifications: 14,
      gcse_equivalent: 30,
      a_level_equivalent: 25,
      degree_plus: 31,
    },
    income: { low: 30, middle: 52, high: 18 },
    urbanization: { urban: 44, suburban: 28, rural: 28 },
  },
  WAL1991: {
    ethnicity: { white_british: 97, asian_british: 1, black_british: 1, mixed: 1, other: 0 },
    age: { young: 19, mid: 22, mature: 33, senior: 26 },
    education: {
      no_qualifications: 42,
      gcse_equivalent: 29,
      a_level_equivalent: 17,
      degree_plus: 12,
    },
    income: { low: 30, middle: 54, high: 16 },
    urbanization: { urban: 40, suburban: 32, rural: 28 },
  },
} as Record<string, Record<string, Record<string, number>>>;

function popWeightedAvg(
  data: Census,
  pop: Record<string, number>,
  cat: string,
  group: string
): number {
  const total = Object.values(pop).reduce((s, p) => s + p, 0);
  let acc = 0;
  for (const [region, p] of Object.entries(pop)) acc += p * (data[region]?.[cat]?.[group] ?? 0);
  return acc / total;
}

describe.each([
  ["SCO 2019", scoRegionCensusData as unknown as Census, SCO_POP, AGG.SCO2019],
  ["SCO 1991", scoRegionCensusData1991 as unknown as Census, SCO_POP, AGG.SCO1991],
  ["WAL 2019", walRegionCensusData as unknown as Census, WAL_POP, AGG.WAL2019],
  ["WAL 1991", walRegionCensusData1991 as unknown as Census, WAL_POP, AGG.WAL1991],
] as const)("%s census", (_name, data, pop, agg) => {
  it("has an entry for every region with all five categories", () => {
    expect(Object.keys(data).sort()).toEqual(Object.keys(pop).sort());
    for (const region of Object.keys(pop)) {
      expect(Object.keys(data[region]).sort()).toEqual(Object.keys(CATEGORIES).sort());
    }
  });

  it("every category in every region sums to exactly 100", () => {
    for (const [region, cats] of Object.entries(data)) {
      for (const [cat, groups] of Object.entries(CATEGORIES)) {
        const sum = groups.reduce((s, g) => s + (cats[cat][g] ?? 0), 0);
        expect(sum, `${region}.${cat}`).toBe(100);
        expect(Object.keys(cats[cat]).sort()).toEqual([...groups].sort());
      }
    }
  });

  it("population-weighted average is within ±4 of the national aggregate", () => {
    for (const [cat, groups] of Object.entries(CATEGORIES)) {
      for (const g of groups) {
        const avg = popWeightedAvg(data, pop, cat, g);
        expect(
          Math.abs(avg - agg[cat][g]),
          `${cat}.${g}: ${avg.toFixed(1)} vs ${agg[cat][g]}`
        ).toBeLessThanOrEqual(4);
      }
    }
  });
});
