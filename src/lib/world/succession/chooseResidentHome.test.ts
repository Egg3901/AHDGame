import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Character } from "@/lib/db/types/character";
import { chooseFederationResidentHome } from "./chooseResidentHome";

describe("protected federation residence choice", () => {
  it("preserves the character and wallet, moves only on owner choice, and rejects a second destination", async () => {
    const mem = createInMemoryDb();
    const applicationId = "1991-default:ussr-split:1";
    const characterId = new ObjectId("0000000000000000000000a1");
    const ownerUserId = new ObjectId("0000000000000000000000a2");
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
    mem.seed("states", [
      { _id: "RUSSIA", countryId: "RU" },
      { _id: "MOSCOW", countryId: "RU" },
    ]);
    mem.seed("countryGameStates", [{ _id: "RU", status: "active", enabledForPlayers: true }]);
    mem.seed("characters", [
      {
        _id: characterId,
        userId: ownerUserId,
        countryId: "RU",
        homeState: "KYIV",
        federationPendingResidenceId: applicationId,
        currencyBalances: { personal: { SUR: 250 } },
      },
    ]);
    mem.seed("federationResidentHolds", [
      {
        _id: `${applicationId}:${characterId}`,
        applicationId,
        characterId: characterId.toString(),
        formerCountryId: "RU",
        formerHomeState: "KYIV",
        successorEntityId: "UKR",
        formerOffice: null,
      },
    ]);
    mem.seed("federationRelocations", [
      {
        _id: `${applicationId}:resident:${characterId}`,
        applicationId,
        kind: "resident",
        subjectId: characterId.toString(),
        status: "pending-choice",
      },
    ]);
    const db = mem as unknown as Db;
    const args = {
      db,
      session: {} as ClientSession,
      applicationId,
      characterId: characterId.toString(),
      ownerUserId: ownerUserId.toString(),
      destination: { countryId: "RU" as const, stateId: "RUSSIA" },
    };
    const first = await chooseFederationResidentHome(args);
    expect(await chooseFederationResidentHome(args)).toEqual(first);
    expect(
      await db.collection<Character>("characters").findOne({ _id: characterId })
    ).toMatchObject({
      countryId: "RU",
      homeState: "RUSSIA",
      currencyBalances: { personal: { SUR: 250 } },
    });
    expect(
      (await db.collection<Character>("characters").findOne({ _id: characterId }))
        ?.federationPendingResidenceId
    ).toBeUndefined();
    await expect(
      chooseFederationResidentHome({
        ...args,
        destination: { countryId: "RU", stateId: "MOSCOW" },
      })
    ).rejects.toThrow("conflicts with an earlier choice");
  });
});
