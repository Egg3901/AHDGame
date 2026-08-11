import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Character } from "@/lib/db/types/character";
import type { RetiredCharacter } from "@/lib/db/types/retiredCharacter";

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/corporations/cleanupShareMarketActivity", () => ({
  cleanupShareMarketActivityForCharacters: vi
    .fn()
    .mockResolvedValue({ ordersCancelled: 1, listingsCancelled: 1, offersCancelled: 1 }),
  cleanupShareMarketActivityForCorporations: vi
    .fn()
    .mockResolvedValue({ ordersCancelled: 2, listingsCancelled: 2, offersCancelled: 2 }),
}));

vi.mock("@/lib/corporations/releaseCharacterHeldSharesToFloat", () => ({
  releaseCharacterHeldSharesToFloat: vi
    .fn()
    .mockResolvedValue({ sharesReleased: 100, positionsReleased: 1 }),
}));

vi.mock("@/lib/corporations/releaseHeldSharesToFloat", () => ({
  releaseCorporationHeldSharesToFloat: vi
    .fn()
    .mockResolvedValue({ sharesReleased: 250, corpsShareholderCleared: 1 }),
}));

vi.mock("@/lib/corporations/releaseCharacterHeldBondsToFloat", () => ({
  releaseCharacterHeldBondsToFloat: vi
    .fn()
    .mockResolvedValue({ unitsReleased: 0, bondsCleared: 0 }),
}));

vi.mock("@/lib/indexFunds/releaseCharacterHeldPositionsToFloat", () => ({
  releaseCharacterHeldIndexFundPositionsToFloat: vi
    .fn()
    .mockResolvedValue({ unitsReleased: 0, positionsReleased: 0 }),
}));

const charId = new ObjectId();
const userId = new ObjectId();

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    _id: charId,
    userId,
    countryId: "US",
    name: "Test Politician",
    homeState: "CA",
    politicalInfluence: 42,
    nationalInfluence: 10,
    favorability: 65,
    infamy: 3,
    funds: 5000,
    cashOnHand: 1200,
    actions: 3,
    donorBaseLevel: 2,
    policies: { economic: 0.4, social: -0.2 },
    party: "1",
    currentOffice: { type: "senate", state: "CA", senateClass: 1 },
    careerHistory: [
      {
        type: "elected",
        office: { type: "house", state: "CA", seatsHeld: 1 },
        officeLabel: "US House (CA)",
        date: new Date("2024-01-01"),
      },
      {
        type: "elected",
        office: { type: "senate", state: "CA", senateClass: 1 },
        officeLabel: "US Senate (CA)",
        date: new Date("2025-01-01"),
      },
    ],
    demographics: { race: "white", gender: "male", education: "college", wealth: "middle" },
    bio: "A test politician.",
    avatarUrl: "/avatar.png",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2025-06-01"),
    ...overrides,
  } as Character;
}

describe("retireCharacter", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();

    db.collection("characterAchievements").countDocuments.mockResolvedValue(5);
    db.collection("elections").find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });
    db.collection("corporations").find.mockImplementation((filter: Record<string, unknown>) => {
      if ("ceoId" in filter) {
        return {
          toArray: vi.fn().mockResolvedValue([{ _id: new ObjectId() }, { _id: new ObjectId() }]),
        };
      }
      return {
        toArray: vi.fn().mockResolvedValue([]),
      };
    });
  });

  it("creates a retirement snapshot with correct data", async () => {
    const { retireCharacter } = await import("./retireCharacter");
    const character = makeCharacter();

    await retireCharacter(db as unknown as Db, character, userId, "player_deleted");

    const insertCall = db.collection("retiredCharacters").insertOne.mock.calls[0]![0] as Omit<
      RetiredCharacter,
      "_id"
    >;

    expect(insertCall.userId).toEqual(userId);
    expect(insertCall.characterId).toEqual(charId);
    expect(insertCall.reason).toBe("player_deleted");
    expect(insertCall.snapshot.name).toBe("Test Politician");
    expect(insertCall.snapshot.stats.cashOnHand).toBe(1200);
    expect(insertCall.snapshot.achievementCount).toBe(5);
    expect(insertCall.snapshot.highestOffice).toBe("US Senate (CA)");
  });

  it("cancels market activity and releases personal plus CEO-corporation holdings", async () => {
    const { retireCharacter } = await import("./retireCharacter");
    const { cleanupShareMarketActivityForCharacters, cleanupShareMarketActivityForCorporations } =
      await import("@/lib/corporations/cleanupShareMarketActivity");
    const { releaseCharacterHeldSharesToFloat } =
      await import("@/lib/corporations/releaseCharacterHeldSharesToFloat");
    const { releaseCorporationHeldSharesToFloat } =
      await import("@/lib/corporations/releaseHeldSharesToFloat");

    const character = makeCharacter();
    await retireCharacter(db as unknown as Db, character, userId, "player_deleted");

    expect(cleanupShareMarketActivityForCharacters).toHaveBeenCalledWith(
      db,
      [charId],
      expect.any(Date),
      true
    );
    expect(cleanupShareMarketActivityForCorporations).toHaveBeenCalledWith(
      db,
      expect.arrayContaining([expect.any(ObjectId)]),
      expect.any(Date),
      true
    );
    expect(releaseCharacterHeldSharesToFloat).toHaveBeenCalledWith(db, [charId], expect.any(Date));
    expect(releaseCorporationHeldSharesToFloat).toHaveBeenCalledTimes(2);
  });

  it("also releases held bonds and index-fund positions (previously an orphaning bug — never released)", async () => {
    const { retireCharacter } = await import("./retireCharacter");
    const { releaseCharacterHeldBondsToFloat } =
      await import("@/lib/corporations/releaseCharacterHeldBondsToFloat");
    const { releaseCharacterHeldIndexFundPositionsToFloat } =
      await import("@/lib/indexFunds/releaseCharacterHeldPositionsToFloat");

    const character = makeCharacter();
    await retireCharacter(db as unknown as Db, character, userId, "player_deleted");

    expect(releaseCharacterHeldBondsToFloat).toHaveBeenCalledWith(db, [charId], expect.any(Date));
    expect(releaseCharacterHeldIndexFundPositionsToFloat).toHaveBeenCalledWith(db, [charId]);
  });

  it("captures held share/bond/index-fund value into the snapshot before release", async () => {
    const { retireCharacter } = await import("./retireCharacter");

    const corpId = new ObjectId();
    const bondId = new ObjectId();
    const fundId = new ObjectId();

    db.collection("corporations").find.mockImplementation((filter: Record<string, unknown>) => {
      if ("ceoId" in filter) {
        return { toArray: vi.fn().mockResolvedValue([]) };
      }
      // "shareholders.characterId" in filter
      return {
        toArray: vi.fn().mockResolvedValue([
          {
            _id: corpId,
            shareholders: [{ characterId: charId, shares: 100 }],
            sharePrice: 50,
            // No liquidCurrencyCode -> pre-forex, sharePrice already ₳.
          },
        ]),
      };
    });
    db.collection("bonds").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: bondId,
          holders: [{ characterId: charId, units: 10 }],
          marketPrice: 1,
        },
      ]),
    });
    db.collection("indexFundPositions").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ fundId, characterId: charId, units: 20 }]),
    });
    db.collection("indexFunds").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: fundId, quotedNav: 15 }]),
    });

    const character = makeCharacter();
    await retireCharacter(db as unknown as Db, character, userId, "player_deleted");

    const insertCall = db.collection("retiredCharacters").insertOne.mock.calls[0]![0] as Omit<
      RetiredCharacter,
      "_id"
    >;

    // shares: 100 * $50 = 5000 (pre-forex, no conversion)
    // bonds: 10 * $1000 face * 1.0 market = 10000 (no currencyCode, no conversion)
    // indexFunds: 20 * 15 NAV (already anchor) = 300
    expect(insertCall.snapshot.stats.shareValueAnchor).toBe(5000);
    expect(insertCall.snapshot.stats.bondValueAnchor).toBe(10000);
    expect(insertCall.snapshot.stats.indexFundValueAnchor).toBe(300);
  });

  it("vacates CEO seats after cleanup", async () => {
    const { retireCharacter } = await import("./retireCharacter");
    const character = makeCharacter();

    await retireCharacter(db as unknown as Db, character, userId, "player_deleted");

    expect(db.collection("corporations").updateMany).toHaveBeenCalledWith(
      { ceoId: charId },
      { $set: { ceoId: null, ceoVacant: true, updatedAt: expect.any(Date) } }
    );
  });

  it("clears state-party leadership seats, not just national ones (ticket #0860)", async () => {
    const { retireCharacter } = await import("./retireCharacter");
    const character = makeCharacter();

    await retireCharacter(db as unknown as Db, character, userId, "player_deleted");

    const statePartyOrgUpdateMany = db.collection("statePartyOrg").updateMany;
    expect(statePartyOrgUpdateMany).toHaveBeenCalledWith(
      { chairId: charId },
      { $set: { chairId: null, updatedAt: expect.any(Date) } }
    );
    expect(statePartyOrgUpdateMany).toHaveBeenCalledWith(
      { viceChairId: charId },
      { $set: { viceChairId: null, updatedAt: expect.any(Date) } }
    );
    expect(statePartyOrgUpdateMany).toHaveBeenCalledWith(
      { treasurerId: charId },
      { $set: { treasurerId: null, updatedAt: expect.any(Date) } }
    );
    expect(statePartyOrgUpdateMany).toHaveBeenCalledWith(
      { campaignerId: charId },
      { $set: { campaignerId: null, updatedAt: expect.any(Date) } }
    );
  });

  it("updates the user record and records lastRetiredAt for player retirement", async () => {
    const { retireCharacter } = await import("./retireCharacter");
    const character = makeCharacter();

    await retireCharacter(db as unknown as Db, character, userId, "player_deleted");

    expect(db.collection("users").updateOne).toHaveBeenCalledWith(
      { _id: userId },
      {
        $set: {
          hasCompletedSetup: false,
          activeCharacterId: null,
          lastRetiredAt: expect.any(Date),
        },
        $inc: { activeCharacterCount: -1 },
      }
    );
  });

  it("does not touch politicalParties for independents", async () => {
    const { retireCharacter } = await import("./retireCharacter");
    const character = makeCharacter({ party: "independent" });

    await retireCharacter(db as unknown as Db, character, userId, "admin_action");

    expect(db.collectionMocks["politicalParties"]).toBeUndefined();
  });

  it("auto-rejects charter signatures and transitions to founder-replacement when character is a founder", async () => {
    const { retireCharacter } = await import("./retireCharacter");
    const character = makeCharacter();

    const charterId = new ObjectId();
    const charterCursor = {
      toArray: vi.fn().mockResolvedValue([{ _id: charterId }]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    };
    db.collection("partyCharters").find.mockReturnValue(charterCursor);

    await retireCharacter(db as unknown as Db, character, userId, "player_deleted");

    expect(db.collection("partyCharters").find).toHaveBeenCalledWith({
      foundersCharacterIds: charId,
      status: { $in: ["draft", "pending-signatures", "founder-replacement"] },
    });
    expect(db.collection("partyCharters").updateOne).toHaveBeenCalledWith(
      {
        _id: charterId,
        "signatures.characterId": charId,
        "signatures.rejectedAt": { $exists: false },
      },
      {
        $set: expect.objectContaining({
          "signatures.$.rejectedAt": expect.any(Date),
          "signatures.$.rejectionReason": "Founder character deleted",
          status: "founder-replacement",
        }),
      }
    );
  });
});
