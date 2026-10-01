import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { loadLiveSuccessionInventory } from "./loadLiveInventory";

describe("live federation inventory", () => {
  it("reads source regions, local public sectors and stationed units without inventing values", async () => {
    const mem = createInMemoryDb();
    const nationalId = new ObjectId("000000000000000000000001");
    const privateId = new ObjectId("000000000000000000000002");
    const publicSectorId = new ObjectId("000000000000000000000003");
    mem.seed("states", [
      { _id: "CEN", countryId: "RU", population: 10, gdp: 100 },
      { _id: "SU_UKR", countryId: "RU", population: 11, gdp: 101 },
      { _id: "CEN_SUB", countryId: "RU", parentRegionId: "CEN", population: 2, gdp: 20 },
      { _id: "CEN_DISTRICT", countryId: "RU", parentRegionId: "CEN_SUB", population: 1, gdp: 10 },
      { _id: "BE", countryId: "DD", population: 12, gdp: 90 },
    ]);
    mem.seed("corporations", [
      { _id: nationalId, countryId: "RU", countryOwnerId: "RU" },
      { _id: privateId, countryId: "RU", ownershipState: "private" },
    ]);
    mem.seed("corporateSectors", [
      { _id: publicSectorId, corporationId: nationalId, countryId: "RU", stateId: "SU_UKR" },
      {
        _id: new ObjectId("000000000000000000000004"),
        corporationId: privateId,
        countryId: "RU",
        stateId: "CEN",
      },
      {
        _id: new ObjectId("000000000000000000000008"),
        corporationId: nationalId,
        countryId: "RU",
        stateId: "CEN_DISTRICT",
      },
    ]);
    mem.seed("militaryUnits", [
      {
        _id: new ObjectId("000000000000000000000005"),
        countryId: "RU",
        domain: "ground",
        station: "CEN_SUB",
      },
      {
        _id: new ObjectId("000000000000000000000006"),
        countryId: "RU",
        domain: "naval",
        station: "north-atlantic",
      },
      {
        _id: new ObjectId("000000000000000000000007"),
        countryId: "RU",
        domain: "rocket",
        station: "CEN",
      },
    ]);
    const inventory = await loadLiveSuccessionInventory(mem as unknown as Db, "RU");
    expect(inventory.sourceRegions).toEqual([
      { regionId: "CEN", population: 10, annualGdpAnchor: 100 },
      { regionId: "SU_UKR", population: 11, annualGdpAnchor: 101 },
    ]);
    expect(inventory.custodyAssets).toEqual([
      {
        assetId: `enterprise:${publicSectorId}`,
        kind: "public-enterprise",
        homeRegionId: "SU_UKR",
      },
      {
        assetId: "enterprise:000000000000000000000008",
        kind: "public-enterprise",
        homeRegionId: "CEN",
      },
      {
        assetId: "force:000000000000000000000005",
        kind: "conventional-force",
        homeRegionId: "CEN",
      },
      {
        assetId: "force:000000000000000000000006",
        kind: "conventional-force",
        homeRegionId: null,
      },
      {
        assetId: "force:000000000000000000000007",
        kind: "strategic-force",
        homeRegionId: "CEN",
      },
    ]);
  });

  it("rejects missing detailed territory rather than publishing empty successor totals", async () => {
    const mem = createInMemoryDb();
    await expect(loadLiveSuccessionInventory(mem as unknown as Db, "RU")).rejects.toThrow(
      "Live federation regions are missing"
    );
  });

  it("rejects a broken source hierarchy before assigning physical custody", async () => {
    const mem = createInMemoryDb();
    mem.seed("states", [
      { _id: "CEN", countryId: "RU", population: 10, gdp: 100 },
      { _id: "ORPHAN", countryId: "RU", parentRegionId: "MISSING", population: 1, gdp: 1 },
    ]);
    await expect(loadLiveSuccessionInventory(mem as unknown as Db, "RU")).rejects.toThrow(
      "region hierarchy has a missing parent"
    );
  });

  it("requires negotiated custody for a public corporation without a physical site", async () => {
    const mem = createInMemoryDb();
    const corporationId = new ObjectId("000000000000000000000009");
    mem.seed("states", [{ _id: "CEN", countryId: "RU", population: 10, gdp: 100 }]);
    mem.seed("corporations", [{ _id: corporationId, countryId: "RU", countryOwnerId: "RU" }]);
    const inventory = await loadLiveSuccessionInventory(mem as unknown as Db, "RU");
    expect(inventory.custodyAssets).toEqual([
      {
        assetId: `enterprise-shell:${corporationId}`,
        kind: "public-enterprise",
        homeRegionId: null,
      },
    ]);
  });
});
