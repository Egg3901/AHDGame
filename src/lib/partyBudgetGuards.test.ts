import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  findPartyBudgetForScope,
  savePartyBudgetForScope,
  resetPartyBudgetSpending,
} from "./partyBudgetGuards";

describe("partyBudgetGuards compatibility helpers", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("partyBudget");
  });

  it("falls back to a legacy countryless budget when no country-scoped row exists", async () => {
    const legacyBudget = {
      _id: new ObjectId(),
      partyId: "1",
      scope: "national",
      gotvBudgetPerTurn: 0,
      gotvBudgetPercent: 12,
      suppressionBudgetPercent: 0,
      orgBuildingPercent: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    db.collectionMocks["partyBudget"]!.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(
      legacyBudget
    );

    const budget = await findPartyBudgetForScope(db.collection("partyBudget"), {
      countryId: "US",
      partyId: "1",
      scope: "national",
    });

    expect(budget).toEqual(legacyBudget);
    expect(db.collectionMocks["partyBudget"]!.findOne.mock.calls[0][0]).toEqual({
      countryId: "US",
      partyId: "1",
      scope: "national",
    });
    expect(db.collectionMocks["partyBudget"]!.findOne.mock.calls[1][0]).toEqual({
      countryId: { $exists: false },
      partyId: "1",
      scope: "national",
    });
  });

  it("copies legacy national rows into a country-scoped replacement instead of claiming them", async () => {
    const now = new Date("2026-04-26T12:00:00.000Z");
    db.collectionMocks["partyBudget"]!.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      _id: new ObjectId(),
      partyId: "1",
      scope: "national",
      gotvBudgetPerTurn: 0,
      gotvBudgetPercent: 5,
      suppressionBudgetPercent: 3,
      orgBuildingPercent: 0,
      createdAt: now,
      updatedAt: now,
    });

    await savePartyBudgetForScope(
      db.collection("partyBudget"),
      {
        countryId: "US",
        partyId: "1",
        scope: "national",
      },
      {
        gotvBudgetPercent: 10,
      },
      now
    );

    expect(db.collectionMocks["partyBudget"]!.updateOne).toHaveBeenCalledWith(
      {
        countryId: "US",
        partyId: "1",
        scope: "national",
      },
      {
        $set: {
          countryId: "US",
          gotvBudgetPerTurn: 0,
          gotvBudgetPercent: 10,
          gotvTargetCategory: undefined,
          gotvTargetGroup: undefined,
          suppressionBudgetPercent: 3,
          suppressionTargetCategory: undefined,
          suppressionTargetGroup: undefined,
          orgBuildingPercent: 0,
          registrationBudgetPercent: 0,
          transferReserveAmount: 0,
          memberSupportReserveAmount: 0,
          nppRecruitmentReserveAmount: 0,
          treasuryPreset: "custom",
          updatedAt: now,
        },
        // $setOnInsert only carries identity + createdAt — budget numeric fields
        // and countryId are covered by $set, so they must not appear here or
        // MongoDB throws MongoServerError: Conflict at path.
        $setOnInsert: {
          partyId: "1",
          scope: "national",
          createdAt: now,
        },
      },
      { upsert: true }
    );
    expect(db.collectionMocks["partyBudget"]!.updateMany).not.toHaveBeenCalled();
  });

  it("creates a fresh country-scoped row when no budget document exists at all", async () => {
    const now = new Date("2026-04-26T12:00:00.000Z");
    // Both strict and legacy lookups return null
    db.collectionMocks["partyBudget"]!.findOne.mockResolvedValue(null);

    await savePartyBudgetForScope(
      db.collection("partyBudget"),
      { countryId: "US", partyId: "1", scope: "national" },
      { gotvBudgetPercent: 20 },
      now
    );

    expect(db.collectionMocks["partyBudget"]!.updateOne).toHaveBeenCalledWith(
      { countryId: "US", partyId: "1", scope: "national" },
      {
        $set: {
          countryId: "US",
          gotvBudgetPerTurn: 0,
          gotvBudgetPercent: 20,
          gotvTargetCategory: undefined,
          gotvTargetGroup: undefined,
          suppressionBudgetPercent: 0,
          suppressionTargetCategory: undefined,
          suppressionTargetGroup: undefined,
          orgBuildingPercent: 0,
          registrationBudgetPercent: 0,
          transferReserveAmount: 0,
          memberSupportReserveAmount: 0,
          nppRecruitmentReserveAmount: 0,
          treasuryPreset: "custom",
          updatedAt: now,
        },
        $setOnInsert: { partyId: "1", scope: "national", createdAt: now },
      },
      { upsert: true }
    );
    expect(db.collectionMocks["partyBudget"]!.updateMany).not.toHaveBeenCalled();
  });

  it("resets national budget spending to 0 via upsert when only a legacy row exists", async () => {
    const now = new Date("2026-04-26T12:00:00.000Z");
    const legacyBudget = {
      _id: new ObjectId(),
      partyId: "1",
      scope: "national",
      gotvBudgetPerTurn: 5,
      gotvBudgetPercent: 10,
      suppressionBudgetPercent: 5,
      orgBuildingPercent: 3,
      createdAt: now,
      updatedAt: now,
    };
    // Strict lookup → null, legacy lookup → legacyBudget
    db.collectionMocks["partyBudget"]!.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(
      legacyBudget
    );

    await resetPartyBudgetSpending(
      db as never,
      { countryId: "US", partyId: "1", scope: "national" },
      now
    );

    expect(db.collectionMocks["partyBudget"]!.updateOne).toHaveBeenCalledWith(
      { countryId: "US", partyId: "1", scope: "national" },
      expect.objectContaining({
        $set: expect.objectContaining({
          gotvBudgetPerTurn: 0,
          gotvBudgetPercent: 0,
          suppressionBudgetPercent: 0,
          orgBuildingPercent: 0,
          countryId: "US",
        }),
        $setOnInsert: expect.objectContaining({ partyId: "1", scope: "national" }),
      }),
      { upsert: true }
    );
  });

  it("updates legacy state rows in place and backfills countryId", async () => {
    const now = new Date("2026-04-26T12:00:00.000Z");
    db.collectionMocks["partyBudget"]!.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      _id: new ObjectId(),
      partyId: "1",
      scope: "state",
      stateId: "PA",
      gotvBudgetPerTurn: 0,
      gotvBudgetPercent: 5,
      suppressionBudgetPercent: 0,
      orgBuildingPercent: 0,
      createdAt: now,
      updatedAt: now,
    });

    await savePartyBudgetForScope(
      db.collection("partyBudget"),
      {
        countryId: "US",
        partyId: "1",
        scope: "state",
        stateId: "PA",
      },
      {
        gotvBudgetPercent: 10,
      },
      now
    );

    expect(db.collectionMocks["partyBudget"]!.updateMany).toHaveBeenCalledWith(
      {
        partyId: "1",
        scope: "state",
        stateId: "PA",
        $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
      },
      {
        $set: {
          gotvBudgetPerTurn: 0,
          gotvBudgetPercent: 10,
          gotvTargetCategory: undefined,
          gotvTargetGroup: undefined,
          suppressionBudgetPercent: 0,
          suppressionTargetCategory: undefined,
          suppressionTargetGroup: undefined,
          orgBuildingPercent: 0,
          registrationBudgetPercent: 0,
          transferReserveAmount: 0,
          memberSupportReserveAmount: 0,
          nppRecruitmentReserveAmount: 0,
          treasuryPreset: "custom",
          countryId: "US",
          updatedAt: now,
        },
      }
    );
    expect(db.collectionMocks["partyBudget"]!.updateOne).not.toHaveBeenCalled();
  });
});
