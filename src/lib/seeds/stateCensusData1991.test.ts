import { describe, it, expect } from "vitest";
import { stateCensusData } from "./stateDemographics";
import { stateCensusData1991 } from "./stateCensusData1991";

const SUM_DIMS = {
  race: ["white", "black", "hispanic", "asian", "other"],
  education: ["no_college", "college", "graduate"],
  wealth: ["low", "middle", "high"],
  age: ["young", "mid", "mature", "senior"],
} as const;

const IDEOLOGY_KEYS = [
  "evangelicals",
  "environmentalists",
  "libertarians",
  "progressives",
  "patriots",
  "gunowners",
] as const;

const avg = (rec: Record<string, unknown>, pick: (p: never) => number) =>
  Object.values(rec).reduce((s: number, p) => s + pick(p as never), 0) / Object.keys(rec).length;

describe("stateCensusData1991", () => {
  it("covers exactly the same states as the 2019 census", () => {
    expect(new Set(Object.keys(stateCensusData1991))).toEqual(
      new Set(Object.keys(stateCensusData))
    );
  });

  it("race, education, wealth, and age each sum to 100 per state", () => {
    for (const [id, profile] of Object.entries(stateCensusData1991)) {
      for (const [dim, keys] of Object.entries(SUM_DIMS)) {
        const sum = keys.reduce(
          (s, k) => s + (profile as unknown as Record<string, Record<string, number>>)[dim][k],
          0
        );
        expect(sum, `${id} ${dim} sum`).toBe(100);
      }
    }
  });

  it("ideology contains all six groups with sane independent shares (not normalized to 100)", () => {
    for (const [id, profile] of Object.entries(stateCensusData1991)) {
      for (const key of IDEOLOGY_KEYS) {
        const v = (profile.ideology as Record<string, number>)[key];
        expect(Number.isInteger(v), `${id} ideology.${key} integer`).toBe(true);
        expect(v, `${id} ideology.${key} min`).toBeGreaterThanOrEqual(0);
        expect(v, `${id} ideology.${key} max`).toBeLessThanOrEqual(60);
      }
    }
  });

  it("is directionally whiter and less college-educated than 2019 on average", () => {
    expect(
      avg(stateCensusData1991, (p: { race: { white: number } }) => p.race.white)
    ).toBeGreaterThan(avg(stateCensusData, (p: { race: { white: number } }) => p.race.white));
    expect(
      avg(stateCensusData1991, (p: { education: { graduate: number } }) => p.education.graduate)
    ).toBeLessThan(
      avg(stateCensusData, (p: { education: { graduate: number } }) => p.education.graduate)
    );
  });

  it("reflects 1991 ideology era: more evangelical, less progressive than 2019 on average", () => {
    expect(
      avg(
        stateCensusData1991,
        (p: { ideology: { evangelicals: number } }) => p.ideology.evangelicals
      )
    ).toBeGreaterThan(
      avg(stateCensusData, (p: { ideology: { evangelicals: number } }) => p.ideology.evangelicals)
    );
    expect(
      avg(
        stateCensusData1991,
        (p: { ideology: { progressives: number } }) => p.ideology.progressives
      )
    ).toBeLessThan(
      avg(stateCensusData, (p: { ideology: { progressives: number } }) => p.ideology.progressives)
    );
  });
});
