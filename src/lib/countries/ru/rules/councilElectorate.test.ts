import { describe, expect, it } from "vitest";
import { freezeRussianCouncilElectorate as freeze } from "./councilElectorate";
import { freezeRussianDumaElectorate } from "./assemblyElectorate";
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
import { RUSSIAN_COUNCIL_POPULATION_WEIGHTS_1991 as weights } from "../data/councilPopulation1991";
import { RU_1991_ECONOMIC_REGION_POPULATION as population } from "../data/ruPopulation1991";
function regions() {
  return Object.entries(population).map(([id, population]) => ({
    id,
    population,
    votingEligiblePopulation: population * 0.7,
  }));
}
describe("Council frozen subject registers", () => {
  it("preserves every current regional registered voter across all 89 historical subjects", () => {
    const input = regions();
    const before = structuredClone(input);
    const pools = { CEN: 13, NOR: 37 };
    const output = freeze(input, pools);
    const regional = freezeRussianDumaElectorate(input, pools);
    expect(Object.keys(output)).toHaveLength(89);
    for (const [region, voters] of Object.entries(regional))
      expect(
        RUSSIAN_COUNCIL_SUBJECTS_1993.filter((row) => row[2] === region).reduce(
          (sum, [number]) => sum + output[`RU-council-${number}`],
          0
        )
      ).toBe(voters);
    expect(output["RU-council-77"]).toBeGreaterThan(output["RU-council-44"]);
    expect(output["RU-council-20"]).toBeGreaterThan(output["RU-council-6"]);
    expect(input).toEqual(before);
  });
  it("keeps source weight totals aligned with the baseline without counting nested okrugs twice", () => {
    for (const [region, total] of Object.entries(population))
      expect(
        RUSSIAN_COUNCIL_SUBJECTS_1993.filter((row) => row[2] === region).reduce(
          (sum, [number]) => sum + weights[`RU-council-${number}`],
          0
        )
      ).toBe((total / 1000) * 1364);
    expect(weights["RU-council-6"] + weights["RU-council-20"]).toBe(1302 * 1364);
    expect(weights["RU-council-6"] * 1172).toBe(weights["RU-council-20"] * 192);
  });
  it("preserves exact totals and deterministic remainders under tiny and large registers", () => {
    const input = regions().map((row) => ({
      ...row,
      votingEligiblePopulation: row.id === "CEN" ? 1_000_000_000_001 : 1,
    }));
    const result = freeze(input, {});
    expect(Object.values(result).reduce((sum, value) => sum + BigInt(value), BigInt(0))).toBe(
      BigInt(1_000_000_000_010)
    );
    expect(freeze([...input].reverse(), {})).toEqual(result);
  });
  it("retains zero-register subject districts when a region has no registered voters", () => {
    const output = freeze(regions(), { NCA: 100 });
    expect(
      RUSSIAN_COUNCIL_SUBJECTS_1993.filter((row) => row[2] === "NCA").every(
        ([number]) => output[`RU-council-${number}`] === 0
      )
    ).toBe(true);
  });
  it("rejects an incomplete macroregion map and unsafe regional registers", () => {
    expect(() => freeze(regions().slice(1), {})).toThrow();
    const input = regions();
    input[0].votingEligiblePopulation = Number.MAX_SAFE_INTEGER + 1;
    expect(() => freeze(input, {})).toThrow();
  });
});
