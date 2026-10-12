import { describe, expect, it } from "vitest";
import { expandLiveRegions } from "./liveRegions";
import { SUB_REGION_SEEDS } from "../subRegions";
import type { State } from "@/lib/db/types/state";

describe("live independence regions", () => {
  for (const country of ["SCO", "WAL"] as const) {
    it(`conserves live stocks and history for ${country}`, () => {
      const source = {
        ...SUB_REGION_SEEDS[country][0],
        _id: country,
        countryId: "UK",
        population: 7000001,
        votingEligiblePopulation: 5000003,
        gdp: 250000,
        capitalStock: 750000,
        outputGap: -2,
        sectorRevenueSnapshots: [{ turn: 99, value: 300 }],
        conflictCapacityApplied: { damage: { destroyed: 100, repaired: 25 } },
        subhourBase: {
          growth: {
            turn: 100,
            gdp: { base: 249000, written: 250000 },
            outputGap: { base: -3, written: -2 },
          },
        },
      } as State;
      const regions = expandLiveRegions(source, SUB_REGION_SEEDS[country]);
      expect(regions.reduce((sum, row) => sum + row.houseDistricts, 0)).toBe(
        country === "SCO" ? 129 : 60
      );
      expect(
        regions.every((row) => Number.isInteger(row.houseDistricts) && row.houseDistricts > 0)
      ).toBe(true);
      expect(expandLiveRegions(source, SUB_REGION_SEEDS[country])).toEqual(regions);
      for (const key of ["population", "votingEligiblePopulation", "gdp", "capitalStock"] as const)
        expect(regions.reduce((sum, row) => sum + row[key]!, 0)).toBeCloseTo(source[key]!, 7);
      expect(
        regions.reduce((sum, row) => sum + row.sectorRevenueSnapshots![0].value, 0)
      ).toBeCloseTo(300);
      expect(
        regions.every((row) => row.outputGap === -2 && row.subhourBase?.growth?.turn === 100)
      ).toBe(true);
      expect(
        regions.reduce(
          (sum, row) => sum + row.conflictCapacityApplied![`damage:${row._id}`].destroyed,
          0
        )
      ).toBeCloseTo(100);
    });
  }
  it("rejects missing live accounting inputs", () => {
    expect(() => expandLiveRegions({ population: 1 } as State, SUB_REGION_SEEDS.SCO)).toThrow();
  });
});
