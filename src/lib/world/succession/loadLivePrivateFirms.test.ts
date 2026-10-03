import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { sectorBookValueAnchor } from "@/lib/corporations/sectorProfitBasis";
import { loadLivePrivateSuccessionFirms } from "./loadLivePrivateFirms";

describe("live private firm succession inventory", () => {
  it("resolves nested source facilities, excludes foreign sites and public firms", async () => {
    const mem = createInMemoryDb();
    const corporationId = new ObjectId("000000000000000000000011");
    const publicId = new ObjectId("000000000000000000000012");
    const nppId = new ObjectId("000000000000000000000016");
    const caretakerId = new ObjectId("000000000000000000000017");
    const facilityId = new ObjectId("000000000000000000000013");
    const facility = {
      _id: facilityId,
      corporationId,
      countryId: "RU",
      stateId: "KYIV",
      sectorType: "manufacturing",
      capacityBookAnchor: 1000,
      capitalStock: 10,
    };
    mem.seed("states", [
      { _id: "UKRAINE", countryId: "RU", population: 10, gdp: 10 },
      { _id: "KYIV", countryId: "RU", parentRegionId: "UKRAINE", population: 5, gdp: 5 },
    ]);
    mem.seed("corporations", [
      { _id: corporationId, countryId: "RU", headquartersState: "KYIV" },
      { _id: publicId, countryId: "RU", headquartersState: "KYIV", countryOwnerId: "RU" },
      { _id: nppId, countryId: "RU", headquartersState: "KYIV", ceoType: "npp" },
      {
        _id: caretakerId,
        countryId: "RU",
        headquartersState: "KYIV",
        ceoType: "npp",
        caretakerCeo: { ceoId: "player" },
      },
    ]);
    mem.seed("corporateSectors", [
      facility,
      { ...facility, _id: new ObjectId("000000000000000000000014"), countryId: "FR" },
      { ...facility, _id: new ObjectId("000000000000000000000015"), corporationId: publicId },
      { ...facility, _id: new ObjectId("000000000000000000000018"), corporationId: nppId },
    ]);
    const firms = await loadLivePrivateSuccessionFirms(mem as unknown as Db, "RU", 1991, 1);
    expect(firms).toEqual([
      {
        corporationId: corporationId.toString(),
        countryId: "RU",
        headquartersState: "KYIV",
        headquartersRegionId: "UKRAINE",
        facilities: [
          {
            sectorId: facilityId.toString(),
            regionId: "UKRAINE",
            bookValueAnchor: sectorBookValueAnchor(facility as never, 1991, 1),
          },
        ],
      },
      {
        corporationId: caretakerId.toString(),
        countryId: "RU",
        headquartersState: "KYIV",
        headquartersRegionId: "UKRAINE",
        facilities: [],
      },
    ]);
  });
});
