import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Corporation } from "@/lib/db/types/corporation";
import { materializeFederationPublicCorporations } from "./materializePublicCorporations";

describe("federation public corporation shell materialization", () => {
  it("archives an emptied enterprise and rebases a mixed enterprise onto retained territory", async () => {
    const mem = createInMemoryDb();
    const archivedId = new ObjectId("000000000000000000000071");
    const mixedId = new ObjectId("000000000000000000000072");
    const archivedSectorId = new ObjectId("000000000000000000000073");
    const retainedSectorId = new ObjectId("000000000000000000000074");
    const applicationId = "1991-default:ussr-split:1";
    mem.seed("corporations", [
      {
        _id: archivedId,
        countryId: "RU",
        countryOwnerId: "RU",
        headquartersState: "UKRAINE",
      },
      {
        _id: mixedId,
        countryId: "RU",
        countryOwnerId: "RU",
        headquartersState: "UKRAINE",
      },
    ]);
    mem.seed("corporateSectors", [
      { _id: retainedSectorId, corporationId: mixedId, countryId: "RU", stateId: "RUSSIA" },
    ]);
    mem.seed("federationArchivedRegionRows", [
      {
        _id: `${applicationId}:corporateSectors:${archivedSectorId.toString()}`,
        applicationId,
        collection: "corporateSectors",
        successorEntityId: "UKR",
        originalId: archivedSectorId.toString(),
        value: { _id: archivedSectorId, corporationId: archivedId, stateId: "UKRAINE" },
      },
    ]);
    const db = mem as unknown as Db;
    expect(
      await materializeFederationPublicCorporations({
        db,
        session: {} as ClientSession,
        applicationId,
        sourceCountryId: "RU",
        transfers: [
          {
            stateId: "RUSSIA",
            parentRegionId: null,
            topLevelRegionId: "RUSSIA",
            successorEntityId: "RU",
            leavesDetailedSource: false,
          },
          {
            stateId: "UKRAINE",
            parentRegionId: null,
            topLevelRegionId: "UKRAINE",
            successorEntityId: "UKR",
            leavesDetailedSource: true,
          },
        ],
        assignments: [
          {
            assetId: `enterprise:${archivedSectorId.toString()}`,
            kind: "public-enterprise",
            custodianEntityId: "UKR",
            disposition: "aggregate-background",
          },
          {
            assetId: `enterprise:${retainedSectorId.toString()}`,
            kind: "public-enterprise",
            custodianEntityId: "RU",
            disposition: "retain-detailed",
          },
        ],
      })
    ).toEqual({ archived: 1, rebased: 1 });
    expect(
      await db.collection<Corporation>("corporations").findOne({ _id: archivedId })
    ).toBeNull();
    expect(
      await db.collection<Corporation>("corporations").findOne({ _id: mixedId })
    ).toMatchObject({
      headquartersState: "RUSSIA",
    });
    expect(await db.collection("federationArchivedPublicCorporations").countDocuments({})).toBe(1);
    expect(await db.collection("federationPublicCorporationRebases").countDocuments({})).toBe(1);
  });
});
