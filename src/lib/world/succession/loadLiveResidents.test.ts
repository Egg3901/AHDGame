import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { loadLiveSuccessionResidents } from "./loadLiveResidents";

describe("live federation residents", () => {
  it("resolves nested home states without moving characters or original nationality", async () => {
    const mem = createInMemoryDb();
    mem.seed("states", [
      { _id: "CEN", countryId: "RU", population: 10, gdp: 100 },
      { _id: "SU_UKR", countryId: "RU", population: 11, gdp: 101 },
      { _id: "SU_KYIV", countryId: "RU", parentRegionId: "SU_UKR", population: 2, gdp: 20 },
    ]);
    mem.seed("characters", [
      {
        _id: new ObjectId("000000000000000000000001"),
        countryId: "RU",
        startingCountryId: "PL",
        homeState: "SU_KYIV",
      },
      { _id: new ObjectId("000000000000000000000002"), countryId: "PL", homeState: "PL_MAZ" },
    ]);
    expect(await loadLiveSuccessionResidents(mem as unknown as Db, "RU")).toEqual([
      {
        characterId: "000000000000000000000001",
        countryId: "RU",
        homeState: "SU_KYIV",
        homeRegionId: "SU_UKR",
      },
    ]);
    expect(
      (await mem.collection("characters").findOne({ countryId: "RU" }))?.startingCountryId
    ).toBe("PL");
  });

  it("rejects a resident whose home state cannot be assigned to a successor", async () => {
    const mem = createInMemoryDb();
    mem.seed("states", [{ _id: "CEN", countryId: "RU", population: 10, gdp: 100 }]);
    mem.seed("characters", [
      { _id: new ObjectId("000000000000000000000001"), countryId: "RU", homeState: "LOST" },
    ]);
    await expect(loadLiveSuccessionResidents(mem as unknown as Db, "RU")).rejects.toThrow(
      "no valid federation home region"
    );
  });
});
