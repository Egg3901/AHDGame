import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const charId = new ObjectId();
const userId = new ObjectId();
const partyId = new ObjectId();

const mockChar = {
  _id: charId,
  userId,
  name: "Jane Smith",
  bio: "A politician",
  countryId: "US",
  homeState: "CA",
  party: "1",
  currentOffice: { type: "senate" },
  politicalInfluence: 42.5,
  nationalInfluence: 18.2,
  favorability: 55,
  infamy: 3,
  funds: 12500,
  cashOnHand: 8000,
  actions: 4,
  donorBaseLevel: 2,
  policies: { economic: 25, social: -10 },
  avatarUrl: null,
  createdAt: new Date("2025-01-01"),
};

const mockParty = {
  _id: partyId,
  countryId: "US",
  sequentialId: 1,
  name: "Democratic Party",
  color: "#1a1aff",
};

const mockState = { _id: "CA", name: "California" };

describe("queryCharacters", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    // Pre-initialize collections so collectionMocks entries exist before tests set them up
    [
      "characters",
      "politicalParties",
      "states",
      "users",
      "electionCandidates",
      "elections",
      "corporations",
      "investorRankingSnapshots",
    ].forEach((n) => db.collection(n));
  });

  it("returns found:false when no character matches name", async () => {
    const cursor = {
      find: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    };
    db.collectionMocks.characters!.find.mockReturnValue(cursor as never);

    const { queryCharacters } = await import("./character");
    const result = await queryCharacters(db as unknown as Db, { name: "Nobody" });

    expect(result).toEqual({ found: false, characters: [] });
  });

  it("maps campaignFunds from local stored balance (post-cf-inconsistency-fix)", async () => {
    const charCursor = {
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([mockChar]),
    };
    db.collectionMocks.characters!.find.mockReturnValue(charCursor as never);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([mockParty]),
    } as never);
    db.collectionMocks.states!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([mockState]),
    } as never);
    db.collectionMocks.users!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.corporations!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.investorRankingSnapshots!.findOne.mockResolvedValue(null);

    const { queryCharacters } = await import("./character");
    const result = await queryCharacters(db as unknown as Db, { name: "Jane" });

    expect(result.found).toBe(true);
    expect(result.characters[0].campaignFunds).toBe(12500);
    expect(result.characters[0].cashOnHand).toBe(8000);
    expect(result.characters[0].netWorth).toBe(12500 + 8000 + 0);
  });

  it("resolves partyId to ObjectId string (not raw sequentialId)", async () => {
    const charCursor = {
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([mockChar]),
    };
    db.collectionMocks.characters!.find.mockReturnValue(charCursor as never);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([mockParty]),
    } as never);
    db.collectionMocks.states!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([mockState]),
    } as never);
    db.collectionMocks.users!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.corporations!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.investorRankingSnapshots!.findOne.mockResolvedValue(null);

    const { queryCharacters } = await import("./character");
    const result = await queryCharacters(db as unknown as Db, { name: "Jane" });

    expect(result.characters[0].partyId).toBe(partyId.toString());
    expect(result.characters[0].partyId).not.toBe("1");
  });

  it("excludes banned users", async () => {
    const charCursor = {
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([mockChar]),
    };
    db.collectionMocks.characters!.find.mockReturnValue(charCursor as never);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.states!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.users!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: userId, isBanned: true }]),
    } as never);
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.corporations!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.investorRankingSnapshots!.findOne.mockResolvedValue(null);

    const { queryCharacters } = await import("./character");
    const result = await queryCharacters(db as unknown as Db, { name: "Jane" });

    expect(result.characters).toHaveLength(0);
  });
});

describe("queryCharacterById", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    [
      "characters",
      "politicalParties",
      "states",
      "users",
      "electionCandidates",
      "elections",
      "corporations",
      "investorRankingSnapshots",
    ].forEach((n) => db.collection(n));
  });

  function mockEnrichmentEmpty() {
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([mockParty]),
    } as never);
    db.collectionMocks.states!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([mockState]),
    } as never);
    db.collectionMocks.users!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.corporations!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.investorRankingSnapshots!.findOne.mockResolvedValue(null);
  }

  it("returns null for an invalid id", async () => {
    const { queryCharacterById } = await import("./character");
    const result = await queryCharacterById(db as unknown as Db, "not-an-id");
    expect(result).toBeNull();
    expect(db.collectionMocks.characters!.findOne).not.toHaveBeenCalled();
  });

  it("returns null when character is missing", async () => {
    db.collectionMocks.characters!.findOne.mockResolvedValue(null);
    const { queryCharacterById } = await import("./character");
    const result = await queryCharacterById(db as unknown as Db, charId.toString());
    expect(result).toBeNull();
  });

  it("resolves by ObjectId", async () => {
    db.collectionMocks.characters!.findOne.mockResolvedValue(mockChar);
    mockEnrichmentEmpty();

    const { queryCharacterById } = await import("./character");
    const result = await queryCharacterById(db as unknown as Db, charId.toString());

    expect(db.collectionMocks.characters!.findOne).toHaveBeenCalledWith({ _id: charId });
    expect(result).toEqual({
      found: true,
      character: expect.objectContaining({ id: charId.toString(), name: "Jane Smith" }),
    });
  });

  it("resolves by sequentialId", async () => {
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      ...mockChar,
      sequentialId: 75,
    });
    mockEnrichmentEmpty();

    const { queryCharacterById } = await import("./character");
    const result = await queryCharacterById(db as unknown as Db, "75");

    expect(db.collectionMocks.characters!.findOne).toHaveBeenCalledWith({ sequentialId: 75 });
    expect(result?.found).toBe(true);
    expect(result?.character.name).toBe("Jane Smith");
  });
});

describe("queryCharacterCareer", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("characters");
  });

  it("returns null when character not found", async () => {
    db.collectionMocks.characters!.findOne.mockResolvedValue(null);
    const { queryCharacterCareer } = await import("./character");
    const result = await queryCharacterCareer(db as unknown as Db, charId.toString());
    expect(result).toBeNull();
  });

  it("returns career history in reverse chronological order", async () => {
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: charId,
      name: "Jane Smith",
      careerHistory: [
        { type: "won_election", officeLabel: "CA-1", party: "1", electionId: "elec1" },
        { type: "left_office", officeLabel: "CA-1", party: "1" },
      ],
    });

    const { queryCharacterCareer } = await import("./character");
    const result = await queryCharacterCareer(db as unknown as Db, charId.toString());

    expect(result).not.toBeNull();
    expect(result!.career[0].type).toBe("left_office");
    expect(result!.career[1].type).toBe("won_election");
  });
});

describe("queryCharacterAchievements", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    ["characters", "characterAchievements", "achievements"].forEach((n) => db.collection(n));
  });

  it("returns null when character not found", async () => {
    db.collectionMocks.characters!.findOne.mockResolvedValue(null);
    const { queryCharacterAchievements } = await import("./character");
    const result = await queryCharacterAchievements(db as unknown as Db, charId.toString());
    expect(result).toBeNull();
  });

  it("merges earned records with achievement definitions", async () => {
    const achId = new ObjectId();
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: charId,
      name: "Jane Smith",
      highlightedAchievements: [],
    });
    db.collectionMocks.characterAchievements!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          characterId: charId,
          achievementId: achId,
          earnedAt: new Date("2025-06-01"),
          isHighlighted: false,
        },
      ]),
    } as never);
    db.collectionMocks.achievements!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: achId,
          name: "First Win",
          description: "Won your first election",
          icon: "🏆",
          category: "elections",
          isHidden: false,
        },
      ]),
    } as never);

    const { queryCharacterAchievements } = await import("./character");
    const result = await queryCharacterAchievements(db as unknown as Db, charId.toString());

    expect(result!.achievements).toHaveLength(1);
    expect(result!.achievements[0].name).toBe("First Win");
    expect(result!.achievements[0].earnedAt).toBe("2025-06-01T00:00:00.000Z");
  });
});
