import { describe, expect, it } from "vitest";
import {
  PL_1991_MACROREGION_POPULATION,
  PL_1991_MACROREGION_VOIVODESHIPS,
  PL_1991_VOIVODESHIP_POPULATION,
} from "./plPopulation1991";

describe("1991 Poland population from the 1991 GUS voivodeship yearbook", () => {
  it("assigns every contemporary voivodeship exactly once and reproduces the national total", () => {
    const sourceNames = Object.keys(PL_1991_VOIVODESHIP_POPULATION);
    const groupedNames = Object.values(PL_1991_MACROREGION_VOIVODESHIPS).flat();
    expect(sourceNames).toHaveLength(49);
    expect(groupedNames).toHaveLength(49);
    expect(new Set(groupedNames).size).toBe(49);
    expect([...groupedNames].sort()).toEqual([...sourceNames].sort());
    expect(Object.values(PL_1991_MACROREGION_POPULATION).reduce((a, b) => a + b, 0)).toBe(
      38_183_200
    );
  });
});
