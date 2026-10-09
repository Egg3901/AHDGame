import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  getCorporateSectorLaneQuery,
  getCorporateSectorLocationKey,
  getSectorOperatingCountryId,
} from "./sectorLocation";

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
    expect(
      getCorporateSectorLocationKey(
        { ...correctSector, sectorType: "manufacturing", industryModel: null },
        stateCountryByStateId
      )
    ).not.toBe(
      getCorporateSectorLocationKey(
        { ...correctSector, sectorType: "manufacturing", industryModel: "vehicles" },
        stateCountryByStateId
      )
    );
  });

  it("keeps the entertainment lane distinct from generic media", () => {
    const corpId = new ObjectId();
    const stateCountryByStateId = new Map([["LON", "UK" as const]]);
    const entertainment = {
      corporationId: corpId,
      countryId: "UK" as const,
      stateId: "LON",
      sectorType: "media" as const,
      mediaDiscriminator: "entertainment" as const,
    };
    const generic = { ...entertainment, mediaDiscriminator: null };

    expect(getCorporateSectorLocationKey(generic, stateCountryByStateId)).not.toBe(
      getCorporateSectorLocationKey(entertainment, stateCountryByStateId)
    );
    expect(getCorporateSectorLaneQuery(entertainment)).toEqual({
      sectorType: "media",
      industryModel: null,
      mediaDiscriminator: "entertainment",
    });
  });
});
