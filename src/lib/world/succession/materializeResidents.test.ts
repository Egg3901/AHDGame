import { ObjectId, type ClientSession, type Db, type Document } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Character } from "@/lib/db/types/character";
import { materializeFederationResidentHolds } from "./materializeResidents";

describe("federation protected resident hold", () => {
  function fixture(count: number) {
    const mem = createInMemoryDb();
    const ids = Array.from(
      { length: count },
      (_, index) => new ObjectId((index + 1).toString(16).padStart(24, "0"))
    );
    mem.seed(
      "characters",
      ids.map((_id) => ({
        _id,
        countryId: "RU",
        homeState: "KYIV",
        currentOffice: { type: "unionCongressDeputy", state: "KYIV" },
        currencyBalances: { personal: { RUB: 200 } },
      }))
    );
    mem.seed(
      "electedOfficials",
      ids.map((characterId) => ({ _id: new ObjectId(), countryId: "RU", characterId }))
    );
    const db = mem as unknown as Db;
    return {
      mem,
      db,
      ids,
      input: {
        db,
        session: {} as ClientSession,
        applicationId: "1991-default:ussr-split:1",
        sourceCountryId: "RU" as const,
        residents: ids.map((id) => ({
          characterId: id.toHexString(),
          countryId: "RU" as const,
          homeState: "KYIV",
          homeRegionId: "UKRAINE",
        })),
        plans: ids.map((id) => ({
          characterId: id.toHexString(),
          successorEntityId: "UKR",
          status: "pending-choice" as const,
          formerCountryId: "RU" as const,
          formerHomeState: "KYIV",
        })),
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
      },
    };
  }

  it.each([1, 100])(
    "uses four batched operations for %i residents, preserving wallets and former offices",
    async (count) => {
      const { db, ids, input } = fixture(count);
      const characters = db.collection<Character>("characters");
      const find = vi.spyOn(characters, "find");
      const bulk = vi.spyOn(characters, "bulkWrite");
      const holds = db.collection("federationResidentHolds");
      const insert = vi.spyOn(holds, "insertMany");
      const officials = db.collection("electedOfficials");
      const vacate = vi.spyOn(officials, "updateMany");
      expect(await materializeFederationResidentHolds(input)).toBe(count);
      expect(find).toHaveBeenCalledTimes(1);
      expect(find.mock.calls[0][1]).toMatchObject({
        session: input.session,
        projection: { countryId: 1, homeState: 1, currentOffice: 1 },
      });
      expect(bulk).toHaveBeenCalledTimes(1);
      expect(bulk.mock.calls[0][0]).toHaveLength(count);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(insert.mock.calls[0][0]).toHaveLength(count);
      expect(vacate).toHaveBeenCalledTimes(1);
      for (const id of ids) {
        expect(await characters.findOne({ _id: id })).toMatchObject({
          currentOffice: null,
          homeState: "KYIV",
          federationPendingResidenceId: input.applicationId,
          currencyBalances: { personal: { RUB: 200 } },
        });
      }
      expect(await holds.countDocuments({ "formerOffice.type": "unionCongressDeputy" })).toBe(
        count
      );
      expect(await officials.countDocuments({ characterId: null })).toBe(count);
    }
  );

  it("validates the last live resident before writing any earlier hold", async () => {
    const { db, ids, input } = fixture(100);
    await db
      .collection<Character>("characters")
      .updateOne({ _id: ids[99] }, { $set: { homeState: "MOSCOW" } });
    await expect(materializeFederationResidentHolds(input)).rejects.toThrow("resident changed");
    expect(await db.collection("federationResidentHolds").countDocuments({})).toBe(0);
    expect(await db.collection("characters").countDocuments({ currentOffice: null })).toBe(0);
    expect(await db.collection("electedOfficials").countDocuments({ characterId: null })).toBe(0);
  });

  it("rejects orphan plans before any live reads or writes", async () => {
    const { db, input } = fixture(1);
    input.plans[0].characterId = new ObjectId().toHexString();
    const find = vi.spyOn(db.collection("characters"), "find");
    await expect(materializeFederationResidentHolds(input)).rejects.toThrow("disagrees");
    expect(find).not.toHaveBeenCalled();
    expect(await db.collection("federationResidentHolds").countDocuments({})).toBe(0);
  });

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
    expect(
      await db.collection<Document & { _id: string }>("electedOfficials").findOne({ _id: "office" })
    ).toMatchObject({
      characterId: null,
    });
    expect(await db.collection("federationResidentHolds").countDocuments({})).toBe(1);
  });
});
