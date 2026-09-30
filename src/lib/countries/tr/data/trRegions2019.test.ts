import { describe, expect, it } from "vitest";
import { trRegions } from "./trRegions";
import { trRegions2019 } from "./trRegions2019";

describe("Turkey modern region population overlay", () => {
  it("matches the national population and 600-seat unicameral assembly", () => {
    expect(trRegions2019).toHaveLength(8);
    expect(trRegions2019.reduce((sum, region) => sum + region.population, 0)).toBe(83_400_000);
    expect(trRegions2019.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(600);
    expect(trRegions2019.every((region) => region.stateSenateSeats === 0)).toBe(true);
    expect(trRegions.reduce((sum, region) => sum + region.population, 0)).toBe(43_500_000);
  });
});
