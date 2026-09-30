import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Character } from "@/lib/db/types/character";
import { materializeFederationResidentHolds } from "./materializeResidents";

describe("federation protected resident hold", () => {
  it("preserves the character and wallet, vacates the old office, and waits for a home choice", async () => {
    const mem = createInMemoryDb();
    const characterId = new ObjectId("000000000000000000000091");
    const applicationId = "1991-default:ussr-split:1";
    mem.seed("characters", [
      {
        _id: characterId,
        countryId: "RU",
        homeState: "KYIV",
        currentOffice: { type: "governor", state: "UKRAINE" },
        currencyBalances: { campaign: 100, personal: { RUB: 200 } },
      },
    ]);
    mem.seed("electedOfficials", [
      { _id: "office", characterId, characterName: "Player", party: "A", electedAt: new Date(0) },
    ]);
    const db = mem as unknown as Db;
    expect(
      await materializeFederationResidentHolds({
        db,
        session: {} as ClientSession,
        applicationId,
        sourceCountryId: "RU",
        residents: [
          {
            characterId: characterId.toString(),
            countryId: "RU",
            homeState: "KYIV",
            homeRegionId: "UKRAINE",
          },
        ],
        plans: [
          {
            characterId: characterId.toString(),
            successorEntityId: "UKR",
            status: "pending-choice",
            formerCountryId: "RU",
            formerHomeState: "KYIV",
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
        now: new Date(1),
      })
    ).toBe(1);
    expect(
      await db.collection<Character>("characters").findOne({ _id: characterId })
    ).toMatchObject({
      countryId: "RU",
      homeState: "KYIV",
      currentOffice: null,
      federationPendingResidenceId: applicationId,
      currencyBalances: { campaign: 100, personal: { RUB: 200 } },
    });
    expect(await db.collection("electedOfficials").findOne({ _id: "office" })).toMatchObject({
      characterId: null,
    });
    expect(await db.collection("federationResidentHolds").countDocuments({})).toBe(1);
  });
});
