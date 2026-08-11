import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { getCorporateSectorLocationKey, getSectorOperatingCountryId } from "./sectorLocation";

describe("sectorLocation", () => {
  it("derives operating country from the destination state when sector data is stale", () => {
    const stateCountryByStateId = new Map([
      ["LON", "UK" as const],
      ["KAN", "JP" as const],
    ]);
    const corpId = new ObjectId();

    const correctSector = {
      corporationId: corpId,
      countryId: "UK" as const,
      stateId: "LON",
      sectorType: "energy" as const,
    };
    const staleSector = {
      corporationId: corpId,
      countryId: "US" as const,
      stateId: "LON",
      sectorType: "energy" as const,
    };

    expect(getSectorOperatingCountryId(staleSector, stateCountryByStateId)).toBe("UK");
    expect(getCorporateSectorLocationKey(correctSector, stateCountryByStateId)).toBe(
      getCorporateSectorLocationKey(staleSector, stateCountryByStateId)
    );
  });
});
