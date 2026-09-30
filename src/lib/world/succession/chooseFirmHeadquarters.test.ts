import { ObjectId, type Db, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Corporation } from "@/lib/db/types/corporation";
import { chooseFederationFirmHeadquarters } from "./chooseFirmHeadquarters";

describe("explicit federation firm headquarters choice", () => {
  it("moves the same-currency firm, restores its prior activity and makes its local facility claim payable once", async () => {
    const mem = createInMemoryDb();
    const applicationId = "1991-default:ussr-split:1";
    const corporationId = new ObjectId("0000000000000000000000a1");
    const ownerUserId = new ObjectId("0000000000000000000000a2");
    const claimId = "ussr-split:facility:plant-1";
    mem.seed("federationSettlementApplications", [
      {
        _id: applicationId,
        presetId: "1991-default",
        settlementId: "ussr-split",
        revision: 1,
        sourceEntityId: "RU",
        entityIds: ["RU", "UKR"],
        status: "applied",
        appliedOnTurn: 97,
      },
    ]);
    mem.seed("worldEntityStates", [
      { _id: "1991-default:RU", applicationId, entityId: "RU", appliedOnTurn: 97 },
      { _id: "1991-default:UKR", applicationId, entityId: "UKR", appliedOnTurn: 97 },
    ]);
    mem.seed("states", [{ _id: "RUSSIA", countryId: "RU" }]);
    mem.seed("federalBudget", [{ _id: "RU", countryId: "RU", currencyCode: "SUR" }]);
    mem.seed("corporations", [
      {
        _id: corporationId,
        userId: ownerUserId,
        countryId: "RU",
        headquartersState: "KYIV",
        liquidCurrencyCode: "SUR",
        liquidCapital: 1000,
        suspended: true,
        federationPendingHeadquartersId: applicationId,
      },
    ]);
    mem.seed("federationPrivateFirmHolds", [
      {
        _id: `${applicationId}:${corporationId.toString()}`,
        applicationId,
        corporationId: corporationId.toString(),
        formerCountryId: "RU",
        formerHeadquartersState: "KYIV",
        successorEntityId: "UKR",
        wasSuspended: false,
        status: "pending-choice",
      },
    ]);
    mem.seed("federationFacilityClaims", [
      {
        _id: `${applicationId}:${claimId}`,
        applicationId,
        claimId,
        corporationId: corporationId.toString(),
        sectorId: "plant-1",
        debtorEntityId: "UKR",
        creditorCountryId: null,
        amountAnchor: 1200,
        status: "contingent",
      },
    ]);
    mem.seed("federationRelocations", [
      {
        _id: `${applicationId}:firm:${corporationId.toString()}`,
        applicationId,
        kind: "firm",
        subjectId: corporationId.toString(),
        status: "pending-choice",
      },
    ]);
    const db = mem as unknown as Db;
    const args = {
      db,
      applicationId,
      corporationId: corporationId.toString(),
      ownerUserId: ownerUserId.toString(),
      destination: { countryId: "RU" as const, stateId: "RUSSIA" },
      now: new Date(1000),
    };
    const first = await chooseFederationFirmHeadquarters(args);
    const second = await chooseFederationFirmHeadquarters(args);
    expect(first.status).toBe("completed");
    expect(second).toEqual(first);
    expect(
      await db.collection<Corporation>("corporations").findOne({ _id: corporationId })
    ).toMatchObject({
      countryId: "RU",
      headquartersState: "RUSSIA",
      suspended: false,
      liquidCapital: 1000,
    });
    expect(
      await db
        .collection<Document & { _id: string }>("federationFacilityClaims")
        .findOne({ _id: `${applicationId}:${claimId}` })
    ).toMatchObject({ status: "payable", creditorCountryId: "RU", amountAnchor: 1200 });
    await expect(
      chooseFederationFirmHeadquarters({
        ...args,
        destination: { countryId: "RU", stateId: "MOSCOW" },
      })
    ).rejects.toThrow("not playable");
  });
});
