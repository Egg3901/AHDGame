import { describe, expect, it } from "vitest";
import { birthRateIndexToTFR } from "@/lib/demographics/flows/fertility";
import { rebaseOpeningFertility } from "./fertilityOpening";

describe("1991 opening fertility rebase", () => {
  it("hits the population-weighted national target without flattening regional order", () => {
    const result = rebaseOpeningFertility(
      [
        { regionId: "A", population: 1_000, legacyBirthRateIndex: 40 },
        { regionId: "B", population: 3_000, legacyBirthRateIndex: 60 },
      ],
      1.82
    );
    const mean =
      result.regions.reduce((sum, row) => sum + row.population * row.openingTfr, 0) / 4_000;
    expect(mean).toBeCloseTo(1.82, 10);
    expect(result.regions[0].openingTfr).toBeLessThan(result.regions[1].openingTfr);
    for (const row of result.regions) {
      expect(birthRateIndexToTFR(row.openingBirthRateIndex, 2.06)).toBeCloseTo(row.openingTfr, 10);
    }
  });

  it("rejects duplicate, invalid, and unrepresentable source stock", () => {
    expect(() => rebaseOpeningFertility([], 2)).toThrow();
    expect(() =>
      rebaseOpeningFertility(
        [
          { regionId: "A", population: 1, legacyBirthRateIndex: 50 },
          { regionId: "A", population: 1, legacyBirthRateIndex: 51 },
        ],
        2
      )
    ).toThrow();
    expect(() =>
      rebaseOpeningFertility([{ regionId: "A", population: 1, legacyBirthRateIndex: 50 }], 20)
    ).toThrow();
  });
});
