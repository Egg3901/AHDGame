import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { getLegacyLeaderboardData } from "./legacyLeaderboard";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function cursorOf(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function aggregateCursorOf(docs: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("getLegacyLeaderboardData", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    resetCorpFxRateCacheForTests();
    db = createMockDb();
    [
      "characters",
      "retiredCharacters",
      "users",
      "characterAchievements",
      "gameState",
      "corporations",
      "bonds",
      "indexFundPositions",
      "indexFunds",
      "exchangeRates",
    ].forEach((name) => db.collection(name));
    db.collectionMocks.characterAchievements.aggregate.mockReturnValue(aggregateCursorOf([]));
    db.collectionMocks.corporations.find.mockReturnValue(cursorOf([]));
    db.collectionMocks.bonds.find.mockReturnValue(cursorOf([]));
    db.collectionMocks.indexFundPositions.find.mockReturnValue(cursorOf([]));
  });

  it("returns no entries when no lives exist", async () => {
    db.collectionMocks.characters.find.mockReturnValue(cursorOf([]));
    db.collectionMocks.retiredCharacters.find.mockReturnValue(cursorOf([]));
    db.collectionMocks.users.find.mockReturnValue(cursorOf([]));

    const data = await getLegacyLeaderboardData(db as unknown as import("mongodb").Db, null);

    expect(data.entries).toEqual([]);
    expect(data.total).toBe(0);
    expect(data.self).toBeNull();
  });

  it("ranks a user by their best life, not their sum of lives", async () => {
    const userId = new ObjectId();
    const weakCharId = new ObjectId();
    const strongCharId = new ObjectId();
    const rivalUserId = new ObjectId();
    const rivalCharId = new ObjectId();

    db.collectionMocks.characters.find.mockReturnValue(cursorOf([]));
    db.collectionMocks.retiredCharacters.find.mockReturnValue(
      cursorOf([
        {
          userId,
          characterId: weakCharId,
          retiredAt: new Date("2026-01-01"),
          reason: "game_reset",
          iteration: { type: "Beta", number: 2 },
          snapshot: {
            name: "Weak Life",
            countryId: "US",
            homeState: "CA",
            stats: {
              politicalInfluence: 10,
              nationalInfluence: 10,
              favorability: 50,
              infamy: 0,
              funds: 0,
            },
            achievementCount: 0,
          },
        },
        {
          userId,
          characterId: strongCharId,
          retiredAt: new Date("2026-02-01"),
          reason: "game_reset",
          iteration: { type: "Beta", number: 2 },
          snapshot: {
            name: "Strong Life",
            countryId: "US",
            homeState: "CA",
            stats: {
              politicalInfluence: 500,
              nationalInfluence: 1000,
              partyInfluence: 200,
              favorability: 80,
              infamy: 0,
              funds: 0,
            },
            achievementCount: 3,
          },
        },
        {
          userId: rivalUserId,
          characterId: rivalCharId,
          retiredAt: new Date("2026-01-15"),
          reason: "game_reset",
          iteration: { type: "Beta", number: 1 },
          snapshot: {
            name: "Rival Life",
            countryId: "UK",
            homeState: "LON",
            stats: {
              politicalInfluence: 200,
              nationalInfluence: 400,
              favorability: 60,
              infamy: 0,
              funds: 0,
            },
            achievementCount: 1,
          },
        },
      ])
    );
    db.collectionMocks.users.find.mockReturnValue(
      cursorOf([
        { _id: userId, isBanned: false },
        { _id: rivalUserId, isBanned: false },
      ])
    );

    const data = await getLegacyLeaderboardData(db as unknown as import("mongodb").Db, {
      userId: String(userId),
    });

    expect(data.entries).toHaveLength(2);
    expect(data.entries[0].displayName).toBe("Strong Life");
    // Composite score: 1000*3 (NI) + 200*3 (party) + 3*250 (achievements) = 4350.
    // Political influence and favorability are deliberately NOT scored.
    expect(data.entries[0].score).toBe(4350);
    expect(data.entries[0].lifetimeLives).toBe(2);
    expect(data.entries[1].displayName).toBe("Rival Life");
    expect(data.self?.rank).toBe(1);
    expect(data.self?.lives).toHaveLength(2);
  });

  it("stays a finite score for a character with negative cashOnHand (debt)", async () => {
    // Regression: log10 of a negative internal-currency amount is NaN, which
    // poisoned the whole composite score and rendered as "—" on the live
    // leaderboard (caught post-deploy: real Beta 2 characters with debt).
    const userId = new ObjectId();
    db.collectionMocks.characters.find.mockReturnValue(cursorOf([]));
    db.collectionMocks.retiredCharacters.find.mockReturnValue(
      cursorOf([
        {
          userId,
          characterId: new ObjectId(),
          retiredAt: new Date("2026-01-01"),
          reason: "game_reset",
          iteration: { type: "Beta", number: 2 },
          snapshot: {
            name: "In The Red",
            countryId: "US",
            homeState: "CA",
            stats: {
              politicalInfluence: 50,
              nationalInfluence: 100,
              favorability: 50,
              infamy: 0,
              funds: 0,
              cashOnHand: -80630,
            },
            achievementCount: 0,
          },
        },
      ])
    );
    db.collectionMocks.users.find.mockReturnValue(cursorOf([{ _id: userId, isBanned: false }]));

    const data = await getLegacyLeaderboardData(db as unknown as import("mongodb").Db, null);

    expect(Number.isFinite(data.entries[0].score)).toBe(true);
    expect(data.entries[0].score).toBe(300); // 100*3 (NI), debt contributes 0 to the wealth term
  });

  it("computes the composite score from national/party influence, achievements, office tier, infamy penalty, and wealth", async () => {
    const userId = new ObjectId();
    db.collectionMocks.characters.find.mockReturnValue(cursorOf([]));
    db.collectionMocks.retiredCharacters.find.mockReturnValue(
      cursorOf([
        {
          userId,
          characterId: new ObjectId(),
          retiredAt: new Date("2026-01-01"),
          reason: "game_reset",
          iteration: { type: "Beta", number: 2 },
          snapshot: {
            name: "Senator Doe",
            countryId: "US",
            homeState: "CA",
            currentOffice: { type: "senate", state: "CA", senateClass: 1 },
            careerHistory: [
              {
                type: "elected",
                office: { type: "senate", state: "CA", senateClass: 1 },
                officeLabel: "Senator (CA, Class 1)",
              },
            ],
            stats: {
              politicalInfluence: 0,
              nationalInfluence: 100,
              partyInfluence: 50,
              favorability: 50,
              infamy: 10,
              funds: 0,
              cashOnHand: 999,
            },
            achievementCount: 2,
          },
        },
      ])
    );
    db.collectionMocks.users.find.mockReturnValue(cursorOf([{ _id: userId, isBanned: false }]));

    const data = await getLegacyLeaderboardData(db as unknown as import("mongodb").Db, null);

    // 100*3 (NI) + 50*3 (party) + 2*250 (achievements) + 4*500 (senate = tier 4)
    // - 10*30 (infamy) + log10(1000)*200 (wealth, no exchangeRates doc so 1:1) = 3250.
    expect(data.entries[0].score).toBe(3250);
    expect(data.entries[0].highestOffice).toBe("Senator (CA, Class 1)");
  });

  it("re-derives highest office from career history instead of trusting a stale frozen label", async () => {
    // Regression: ticket #991 fixed deriveHighestOffice to stop crediting
    // lost_election events, but retiredCharacters snapshots taken BEFORE that
    // fix still carry the old wrong label forever (confirmed live: 8/606 real
    // Beta 2 characters had "President" credited off a lost_election-only
    // career history). The leaderboard must re-derive live from raw
    // careerHistory/currentOffice, not trust the frozen snapshot.highestOffice.
    const userId = new ObjectId();
    db.collectionMocks.characters.find.mockReturnValue(cursorOf([]));
    db.collectionMocks.retiredCharacters.find.mockReturnValue(
      cursorOf([
        {
          userId,
          characterId: new ObjectId(),
          retiredAt: new Date("2026-01-01"),
          reason: "game_reset",
          iteration: { type: "Beta", number: 2 },
          snapshot: {
            name: "Almost President",
            countryId: "US",
            homeState: "TX",
            // Stale, wrong label frozen at retirement — the real careerHistory
            // below shows they only ever won Governor, never President.
            highestOffice: "President of the United States",
            currentOffice: { type: "governor", state: "TX" },
            careerHistory: [
              {
                type: "lost_election",
                office: { type: "president" },
                officeLabel: "President of the United States",
              },
              {
                type: "elected",
                office: { type: "governor", state: "TX" },
                officeLabel: "Governor of TX",
              },
            ],
            stats: {
              politicalInfluence: 90,
              nationalInfluence: 0,
              favorability: 50,
              infamy: 0,
              funds: 0,
            },
            achievementCount: 0,
          },
        },
      ])
    );
    db.collectionMocks.users.find.mockReturnValue(cursorOf([{ _id: userId, isBanned: false }]));

    const data = await getLegacyLeaderboardData(db as unknown as import("mongodb").Db, null);

    expect(data.entries[0].highestOffice).toBe("Governor of TX");
    // Governor = tier 5 * 500 = 2500, NOT president's tier 8 * 500 = 4000.
    expect(data.entries[0].scoreBreakdown.officeTier).toBe(2500);
  });

  it("excludes banned users from the leaderboard", async () => {
    const bannedUserId = new ObjectId();
    db.collectionMocks.characters.find.mockReturnValue(cursorOf([]));
    db.collectionMocks.retiredCharacters.find.mockReturnValue(
      cursorOf([
        {
          userId: bannedUserId,
          characterId: new ObjectId(),
          retiredAt: new Date(),
          reason: "game_reset",
          iteration: { type: "Beta", number: 2 },
          snapshot: {
            name: "Banned Player",
            countryId: "US",
            homeState: "CA",
            stats: {
              politicalInfluence: 9999,
              nationalInfluence: 9999,
              favorability: 50,
              infamy: 0,
              funds: 0,
            },
            achievementCount: 0,
          },
        },
      ])
    );
    db.collectionMocks.users.find.mockReturnValue(
      cursorOf([{ _id: bannedUserId, isBanned: true }])
    );

    const data = await getLegacyLeaderboardData(db as unknown as import("mongodb").Db, null);

    expect(data.entries).toEqual([]);
  });

  it("honors a display-name preference pointing at a different life", async () => {
    const userId = new ObjectId();
    const strongCharId = new ObjectId();
    const nostalgiaCharId = new ObjectId();

    db.collectionMocks.characters.find.mockReturnValue(cursorOf([]));
    db.collectionMocks.retiredCharacters.find.mockReturnValue(
      cursorOf([
        {
          userId,
          characterId: strongCharId,
          retiredAt: new Date("2026-02-01"),
          reason: "game_reset",
          iteration: { type: "Beta", number: 2 },
          snapshot: {
            name: "High Scorer",
            countryId: "US",
            homeState: "CA",
            stats: {
              politicalInfluence: 500,
              nationalInfluence: 1000,
              favorability: 80,
              infamy: 0,
              funds: 0,
            },
            achievementCount: 3,
          },
        },
        {
          userId,
          characterId: nostalgiaCharId,
          retiredAt: new Date("2025-01-01"),
          reason: "game_reset",
          iteration: { type: "Beta", number: 1 },
          snapshot: {
            name: "Original OC",
            countryId: "US",
            homeState: "CA",
            stats: {
              politicalInfluence: 5,
              nationalInfluence: 5,
              favorability: 50,
              infamy: 0,
              funds: 0,
            },
            achievementCount: 0,
          },
        },
      ])
    );
    db.collectionMocks.users.find.mockReturnValue(
      cursorOf([
        { _id: userId, isBanned: false, legacyDisplayCharacterId: String(nostalgiaCharId) },
      ])
    );

    const data = await getLegacyLeaderboardData(db as unknown as import("mongodb").Db, null);

    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].displayName).toBe("Original OC");
    // score is the scoring (best) life's composite score, not the displayed
    // life's: 1000*3 (NI) + 3*250 (achievements) = 3750.
    expect(data.entries[0].score).toBe(3750);
  });

  describe("net worth: shares, bonds, and index funds", () => {
    it("includes an active character's held corporation shares, forex-converted", async () => {
      const userId = new ObjectId();
      const characterId = new ObjectId();
      const corpId = new ObjectId();

      db.collectionMocks.characters.find.mockReturnValue(
        cursorOf([
          {
            _id: characterId,
            userId,
            name: "Mogul",
            countryId: "US",
            homeState: "CA",
            currencyBalances: { personal: {}, savings: {} },
          },
        ])
      );
      db.collectionMocks.retiredCharacters.find.mockReturnValue(cursorOf([]));
      db.collectionMocks.users.find.mockReturnValue(cursorOf([{ _id: userId, isBanned: false }]));
      db.collectionMocks.corporations.find.mockReturnValue(
        cursorOf([
          {
            _id: corpId,
            shareholders: [{ characterId, shares: 100 }],
            sharePrice: 50,
            // No liquidCurrencyCode -> pre-forex, sharePrice already in ₳.
          },
        ])
      );

      const data = await getLegacyLeaderboardData(db as unknown as import("mongodb").Db, null, {
        rankBy: "netWorth",
      });

      // 100 shares * $50 sharePrice = 5000 ₳ (pre-forex corp, no conversion).
      expect(data.entries[0].netWorthBreakdown.shares).toBe(5000);
      expect(data.entries[0].netWorth).toBe(5000);
    });

    it("includes an active character's held bonds, forex-converted", async () => {
      const userId = new ObjectId();
      const characterId = new ObjectId();
      const bondId = new ObjectId();

      db.collectionMocks.characters.find.mockReturnValue(
        cursorOf([
          {
            _id: characterId,
            userId,
            name: "Creditor",
            countryId: "US",
            homeState: "CA",
            currencyBalances: { personal: {}, savings: {} },
          },
        ])
      );
      db.collectionMocks.retiredCharacters.find.mockReturnValue(cursorOf([]));
      db.collectionMocks.users.find.mockReturnValue(cursorOf([{ _id: userId, isBanned: false }]));
      db.collectionMocks.bonds.find.mockReturnValue(
        cursorOf([
          {
            _id: bondId,
            holders: [{ characterId, units: 10 }],
            marketPrice: 1,
            // No currencyCode -> treated as already-₳ (no conversion).
          },
        ])
      );

      const data = await getLegacyLeaderboardData(db as unknown as import("mongodb").Db, null, {
        rankBy: "netWorth",
      });

      // 10 units * $1000 face value * 1.0 market price = 10000 ₳.
      expect(data.entries[0].netWorthBreakdown.bonds).toBe(10000);
    });

    it("includes an active character's held index-fund positions valued at NAV", async () => {
      const userId = new ObjectId();
      const characterId = new ObjectId();
      const fundId = new ObjectId();

      db.collectionMocks.characters.find.mockReturnValue(
        cursorOf([
          {
            _id: characterId,
            userId,
            name: "Indexer",
            countryId: "US",
            homeState: "CA",
            currencyBalances: { personal: {}, savings: {} },
          },
        ])
      );
      db.collectionMocks.retiredCharacters.find.mockReturnValue(cursorOf([]));
      db.collectionMocks.users.find.mockReturnValue(cursorOf([{ _id: userId, isBanned: false }]));
      db.collectionMocks.indexFundPositions.find.mockReturnValue(
        cursorOf([{ fundId, characterId, units: 20, holderKind: "character" }])
      );
      db.collectionMocks.indexFunds.find.mockReturnValue(
        cursorOf([{ _id: fundId, quotedNav: 15 }])
      );

      const data = await getLegacyLeaderboardData(db as unknown as import("mongodb").Db, null, {
        rankBy: "netWorth",
      });

      // 20 units * 15 NAV (already anchor-denominated) = 300.
      expect(data.entries[0].netWorthBreakdown.indexFunds).toBe(300);
    });

    it("reads share/bond/fund value from the retirement snapshot for retired characters, not live queries", async () => {
      const userId = new ObjectId();
      db.collectionMocks.characters.find.mockReturnValue(cursorOf([]));
      db.collectionMocks.retiredCharacters.find.mockReturnValue(
        cursorOf([
          {
            userId,
            characterId: new ObjectId(),
            retiredAt: new Date("2026-01-01"),
            reason: "game_reset",
            iteration: { type: "Beta", number: 2 },
            snapshot: {
              name: "Diversified",
              countryId: "US",
              homeState: "CA",
              stats: {
                politicalInfluence: 0,
                favorability: 50,
                infamy: 0,
                funds: 0,
                cashOnHand: 100,
                savingsOnHand: 200,
                shareValueAnchor: 1000,
                bondValueAnchor: 500,
                indexFundValueAnchor: 250,
              },
              achievementCount: 0,
            },
          },
        ])
      );
      db.collectionMocks.users.find.mockReturnValue(cursorOf([{ _id: userId, isBanned: false }]));

      const data = await getLegacyLeaderboardData(db as unknown as import("mongodb").Db, null, {
        rankBy: "netWorth",
      });

      expect(data.entries[0].netWorthBreakdown).toEqual({
        personal: 100,
        savings: 200,
        shares: 1000,
        bonds: 500,
        indexFunds: 250,
      });
      expect(data.entries[0].netWorth).toBe(2050); // 100 + 200 + 1000 + 500 + 250
    });

    it("defaults share/bond/fund value to 0 for a retirement snapshot predating those fields", async () => {
      const userId = new ObjectId();
      db.collectionMocks.characters.find.mockReturnValue(cursorOf([]));
      db.collectionMocks.retiredCharacters.find.mockReturnValue(
        cursorOf([
          {
            userId,
            characterId: new ObjectId(),
            retiredAt: new Date("2026-01-01"),
            reason: "game_reset",
            iteration: { type: "Beta", number: 2 },
            snapshot: {
              name: "Old Snapshot",
              countryId: "US",
              homeState: "CA",
              stats: {
                politicalInfluence: 0,
                favorability: 50,
                infamy: 0,
                funds: 0,
                cashOnHand: 100,
                // No savingsOnHand/shareValueAnchor/bondValueAnchor/indexFundValueAnchor.
              },
              achievementCount: 0,
            },
          },
        ])
      );
      db.collectionMocks.users.find.mockReturnValue(cursorOf([{ _id: userId, isBanned: false }]));

      const data = await getLegacyLeaderboardData(db as unknown as import("mongodb").Db, null, {
        rankBy: "netWorth",
      });

      expect(data.entries[0].netWorth).toBe(100);
    });

    it("rankBy: netWorth sorts by net worth even when it disagrees with Legacy Score rank", async () => {
      const richUserId = new ObjectId();
      const accomplishedUserId = new ObjectId();

      db.collectionMocks.characters.find.mockReturnValue(cursorOf([]));
      db.collectionMocks.retiredCharacters.find.mockReturnValue(
        cursorOf([
          {
            userId: richUserId,
            characterId: new ObjectId(),
            retiredAt: new Date("2026-01-01"),
            reason: "game_reset",
            iteration: { type: "Beta", number: 2 },
            snapshot: {
              name: "Tycoon",
              countryId: "US",
              homeState: "CA",
              stats: {
                politicalInfluence: 0,
                nationalInfluence: 0,
                favorability: 50,
                infamy: 0,
                funds: 0,
                cashOnHand: 1_000_000,
              },
              achievementCount: 0,
            },
          },
          {
            userId: accomplishedUserId,
            characterId: new ObjectId(),
            retiredAt: new Date("2026-01-01"),
            reason: "game_reset",
            iteration: { type: "Beta", number: 2 },
            snapshot: {
              name: "Statesman",
              countryId: "US",
              homeState: "CA",
              stats: {
                politicalInfluence: 0,
                nationalInfluence: 5000,
                favorability: 50,
                infamy: 0,
                funds: 0,
                cashOnHand: 0,
              },
              achievementCount: 20,
            },
          },
        ])
      );
      db.collectionMocks.users.find.mockReturnValue(
        cursorOf([
          { _id: richUserId, isBanned: false },
          { _id: accomplishedUserId, isBanned: false },
        ])
      );

      const legacyRanked = await getLegacyLeaderboardData(
        db as unknown as import("mongodb").Db,
        null
      );
      expect(legacyRanked.entries[0].displayName).toBe("Statesman"); // wins on Legacy Score

      const netWorthRanked = await getLegacyLeaderboardData(
        db as unknown as import("mongodb").Db,
        null,
        { rankBy: "netWorth" }
      );
      expect(netWorthRanked.entries[0].displayName).toBe("Tycoon"); // wins on net worth
    });
  });

  describe("scope filtering", () => {
    const currentIteration = { type: "Iteration" as const, number: 1 };

    it("scope: current only ranks lives from the active iteration", async () => {
      db.collectionMocks.gameState.findOne.mockResolvedValue({
        _id: "current",
        iteration: currentIteration,
      });

      const currentEraUserId = new ObjectId();
      const pastEraUserId = new ObjectId();

      db.collectionMocks.characters.find.mockReturnValue(cursorOf([]));
      db.collectionMocks.retiredCharacters.find.mockReturnValue(
        cursorOf([
          {
            userId: currentEraUserId,
            characterId: new ObjectId(),
            retiredAt: new Date("2026-07-23"),
            reason: "game_reset",
            iteration: currentIteration,
            snapshot: {
              name: "Fresh Start",
              countryId: "US",
              homeState: "CA",
              stats: {
                politicalInfluence: 10,
                nationalInfluence: 50,
                favorability: 50,
                infamy: 0,
                funds: 0,
              },
              achievementCount: 0,
            },
          },
          {
            userId: pastEraUserId,
            characterId: new ObjectId(),
            retiredAt: new Date("2026-01-01"),
            reason: "game_reset",
            iteration: { type: "Beta", number: 2 },
            snapshot: {
              name: "Old Legend",
              countryId: "US",
              homeState: "CA",
              stats: {
                politicalInfluence: 500,
                nationalInfluence: 5000,
                favorability: 80,
                infamy: 0,
                funds: 0,
              },
              achievementCount: 10,
            },
          },
        ])
      );
      db.collectionMocks.users.find.mockReturnValue(
        cursorOf([
          { _id: currentEraUserId, isBanned: false },
          { _id: pastEraUserId, isBanned: false },
        ])
      );

      const data = await getLegacyLeaderboardData(db as unknown as import("mongodb").Db, null, {
        scope: "current",
      });

      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].displayName).toBe("Fresh Start");
    });

    it("scope: all (default) includes lives from every iteration", async () => {
      db.collectionMocks.gameState.findOne.mockResolvedValue({
        _id: "current",
        iteration: currentIteration,
      });

      const pastEraUserId = new ObjectId();
      db.collectionMocks.characters.find.mockReturnValue(cursorOf([]));
      db.collectionMocks.retiredCharacters.find.mockReturnValue(
        cursorOf([
          {
            userId: pastEraUserId,
            characterId: new ObjectId(),
            retiredAt: new Date("2026-01-01"),
            reason: "game_reset",
            iteration: { type: "Beta", number: 2 },
            snapshot: {
              name: "Old Legend",
              countryId: "US",
              homeState: "CA",
              stats: {
                politicalInfluence: 500,
                nationalInfluence: 5000,
                favorability: 80,
                infamy: 0,
                funds: 0,
              },
              achievementCount: 10,
            },
          },
        ])
      );
      db.collectionMocks.users.find.mockReturnValue(
        cursorOf([{ _id: pastEraUserId, isBanned: false }])
      );

      const data = await getLegacyLeaderboardData(db as unknown as import("mongodb").Db, null);

      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].displayName).toBe("Old Legend");
    });
  });
});
