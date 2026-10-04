import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getHeadOfGovernmentCharacterIds } from "./headOfGovernment";

describe("getHeadOfGovernmentCharacterIds", () => {
  const countries = ["US", "UK", "RO", "JP"] as const;
  const usPresident = new ObjectId();
  const ukPrimeMinister = new ObjectId();
  const romanianPrimeMinister = new ObjectId();
  const japaneseLegacyPrimeMinister = new ObjectId();
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    db.collection("countryState");
    db.collection("gameState");
    db.collection("governmentFormations");
    db.collection("electedOfficials");
    db.collection("parliamentaryGovernments");
    db.collectionMocks.countryState.find.mockReturnValue({
      toArray: async () => [
        { _id: "US", countryId: "US", governmentType: "presidential" },
        { _id: "UK", countryId: "UK", governmentType: "parliamentary" },
        { _id: "RO", countryId: "RO", governmentType: "presidential" },
        { _id: "JP", countryId: "JP", governmentType: "parliamentary" },
      ],
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ preset: "2027-default" });
    db.collectionMocks.governmentFormations.find.mockReturnValue({
      toArray: async () => [
        { _id: "UK", countryId: "UK", pmCharacterId: ukPrimeMinister },
        { _id: "RO", countryId: "RO", pmCharacterId: romanianPrimeMinister },
      ],
    });
    db.collectionMocks.electedOfficials.find.mockReturnValue({
      toArray: async () => [{ countryId: "US", characterId: usPresident }],
    });
    db.collectionMocks.parliamentaryGovernments.find.mockReturnValue({
      toArray: async () => [
        { _id: "JP", countryId: "JP", pmCharacterId: japaneseLegacyPrimeMinister },
      ],
    });
  });

  it("resolves mixed government systems with bounded country and formation reads", async () => {
    const result = await getHeadOfGovernmentCharacterIds(db as unknown as Db, countries);

    expect(
      [...result].map(([countryId, characterId]) => [countryId, characterId?.toString()])
    ).toEqual([
      ["US", usPresident.toString()],
      ["UK", ukPrimeMinister.toString()],
      ["RO", romanianPrimeMinister.toString()],
      ["JP", japaneseLegacyPrimeMinister.toString()],
    ]);
    expect(db.collectionMocks.countryState.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.countryState.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.governmentFormations.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.governmentFormations.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.electedOfficials.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.electedOfficials.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.parliamentaryGovernments.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.parliamentaryGovernments.findOne).not.toHaveBeenCalled();
  });
});
