import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Corporation } from "@/lib/db/types/corporation";
import { materializeFederationPrivateFirms } from "./materializePrivateFirms";

describe("federation player firm protection", () => {
  it("preserves a player firm while its background facilities become claims and its HQ awaits choice", async () => {
    const mem = createInMemoryDb();
    const corporationId = new ObjectId("000000000000000000000081");
    const sectorId = new ObjectId("000000000000000000000082");
    const applicationId = "1991-default:ussr-split:1";
    const claimId = "ussr-split:facility:" + sectorId.toString();
    mem.seed("corporations", [
      { _id: corporationId, countryId: "RU", headquartersState: "KYIV", suspended: false },
    ]);
    mem.seed("federationArchivedRegionRows", [
      {
        _id: `${applicationId}:corporateSectors:${sectorId.toString()}`,
        applicationId,
        successorEntityId: "UKR",
        value: { _id: sectorId, corporationId, stateId: "KYIV" },
      },
    ]);
    mem.seed("federationFacilityClaims", [
      {
        _id: `${applicationId}:${claimId}`,
        applicationId,
        claimId,
        corporationId: corporationId.toString(),
        status: "contingent",
        amountAnchor: 1200,
      },
    ]);
    const db = mem as unknown as Db;
    const origins = await materializeFederationPrivateFirms({
      db,
      session: {} as ClientSession,
      applicationId,
      sourceCountryId: "RU",
      firms: [
        {
          corporationId: corporationId.toString(),
          countryId: "RU",
          headquartersState: "KYIV",
          headquartersRegionId: "UKRAINE",
          facilities: [
            { sectorId: sectorId.toString(), regionId: "UKRAINE", bookValueAnchor: 1200 },
          ],
        },
      ],
      plans: [
        {
          corporationId: corporationId.toString(),
          status: "pending-headquarters",
          claims: [
            {
              claimId,
              corporationId: corporationId.toString(),
              sectorId: sectorId.toString(),
              debtorEntityId: "UKR",
              creditorCountryId: null,
              amountAnchor: 1200,
            },
          ],
        },
      ],
      transfers: [
        {
          stateId: "KYIV",
          parentRegionId: "UKRAINE",
          topLevelRegionId: "UKRAINE",
          successorEntityId: "UKR",
          leavesDetailedSource: true,
        },
      ],
    });
    expect(origins[corporationId.toString()]).toEqual({
      countryId: "RU",
      stateId: "KYIV",
      entityId: "UKR",
      wasSuspended: false,
    });
    expect(
      await db.collection<Corporation>("corporations").findOne({ _id: corporationId })
    ).toMatchObject({
      federationPendingHeadquartersId: applicationId,
      suspended: true,
      headquartersState: "KYIV",
    });
    expect(await db.collection("federationPrivateFirmHolds").countDocuments({})).toBe(1);
  });
});
