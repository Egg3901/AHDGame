/**
 * Integration tests for character creation endpoint.
 * Tests end-to-end character creation flow with mocked database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MongoServerError, ObjectId } from "mongodb";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";

// Mock dependencies
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
}));

vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 42, effectiveNow: new Date() }),
}));

describe("POST /api/auth/character - Character Creation", () => {
  const mockUserId = new ObjectId().toString();

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock cookies
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "mock-token" }),
      set: vi.fn(),
    } as any);

    // Mock JWT verification
    const { jwtVerify } = await import("jose");
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        userId: mockUserId,
        email: "test@example.com",
        username: "testuser",
        role: "player",
        isAdmin: false,
        iat: Math.floor(Date.now() / 1000),
      },
    } as any);
  });

  it("creates US character with valid data", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const mockStateDoc = {
      _id: "CA",
      name: "California",
      countryId: "US",
    };

    const mockGameConfig = {
      _id: "default",
      startingFunds: 50000,
      startingActions: 3,
      startingPoliticalInfluence: 0,
      startingFavorability: 50,
      startingInfamy: 0,
      startingDonorBaseLevel: 1,
    };

    const mockUser = {
      _id: new ObjectId(mockUserId),
      username: "testuser",
      hasCompletedSetup: false,
    };

    // Create mock functions to track calls
    const charactersInsertOne = vi.fn().mockResolvedValue({
      insertedId: new ObjectId(),
      acknowledged: true,
    });
    const usersUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "states") {
          return {
            // `loadUsPoliticalStateIds` reads admitted states with find().
            // Empty is faithful for these fixtures: the home states they use
            // carry house seats for the preset, so admission is not what gates
            // them.
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            findOne: vi.fn().mockResolvedValue(mockStateDoc),
          };
        }
        if (name === "characters") {
          return {
            findOne: vi.fn().mockResolvedValue(null), // No existing character
            insertOne: charactersInsertOne,
          };
        }
        if (name === "gameConfig") {
          return {
            findOne: vi.fn().mockResolvedValue(mockGameConfig),
          };
        }
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue(mockUser),
            updateOne: usersUpdateOne,
          };
        }
        if (name === "requestLogs") {
          return {
            insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
          };
        }
        if (name === "adminLogs") {
          return {
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          };
        }
        if (name === "counters") {
          return {
            findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
        };
      }),
    };

    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { POST } = await import("../character/route");
    const req = new Request("http://localhost/api/auth/character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "John Smith",
        homeState: "CA",
        countryId: "US",
        party: "democrat",
        policies: {
          economic: -2,
          social: -1,
        },
        demographics: {
          race: "white",
          gender: "male",
          education: "college",
          wealth: "middle",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json).toHaveProperty("message");
    expect(json).toHaveProperty("characterId");
    expect(json.message).toContain("created");

    // Verify database insertions
    expect(charactersInsertOne).toHaveBeenCalled();

    // Verify character data structure
    const insertCall = charactersInsertOne.mock.calls[0][0];
    expect(insertCall).toMatchObject({
      name: "John Smith",
      homeState: "CA",
      party: "democrat",
      countryId: "US",
      donorBaseLevel: 1,
      // Turn-first anchor for the new-character transfer barrier.
      createdTurn: 42,
    });

    expect(usersUpdateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(mockUserId) },
      expect.objectContaining({
        $set: expect.objectContaining({
          accountCountryId: "US",
        }),
      })
    );
  }, 15_000);

  it("awards referral personal capital to both players", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const referredById = new ObjectId();
    const referrerCharacterId = new ObjectId();

    const mockStateDoc = {
      _id: "CA",
      name: "California",
      countryId: "US",
    };

    const mockGameConfig = {
      _id: "default",
      startingFunds: 50000,
      startingActions: 3,
      startingPoliticalInfluence: 0,
      startingFavorability: 50,
      startingInfamy: 0,
      startingDonorBaseLevel: 1,
    };

    const mockUser = {
      _id: new ObjectId(mockUserId),
      username: "testuser",
      hasCompletedSetup: false,
      referredBy: referredById,
    };

    const charactersFindOne = vi.fn().mockImplementation((query: { userId: ObjectId }) => {
      if (query.userId?.toString() === referredById.toString()) {
        return Promise.resolve({
          _id: referrerCharacterId,
          userId: referredById,
          name: "Referrer",
        });
      }
      return Promise.resolve(null);
    });
    const charactersInsertOne = vi.fn().mockResolvedValue({
      insertedId: new ObjectId(),
      acknowledged: true,
    });
    const charactersUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const usersUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "states") {
          return {
            // `loadUsPoliticalStateIds` reads admitted states with find().
            // Empty is faithful for these fixtures: the home states they use
            // carry house seats for the preset, so admission is not what gates
            // them.
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            findOne: vi.fn().mockResolvedValue(mockStateDoc),
          };
        }
        if (name === "characters") {
          return {
            findOne: charactersFindOne,
            insertOne: charactersInsertOne,
            updateOne: charactersUpdateOne,
          };
        }
        if (name === "gameConfig") {
          return {
            findOne: vi.fn().mockResolvedValue(mockGameConfig),
          };
        }
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue(mockUser),
            updateOne: usersUpdateOne,
          };
        }
        if (name === "adminLogs") {
          return {
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          };
        }
        if (name === "counters") {
          return {
            findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
        };
      }),
    };

    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { POST } = await import("../character/route");
    const req = new Request("http://localhost/api/auth/character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Jane Smith",
        homeState: "CA",
        countryId: "US",
        party: "democrat",
        policies: {
          economic: -1,
          social: 0,
        },
        demographics: {
          race: "white",
          gender: "female",
          education: "college",
          wealth: "middle",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const insertedCharacter = charactersInsertOne.mock.calls[0][0];
    // Campaign funds come from gameConfig.startingFunds; personal cash from wealth bonus + referral
    expect(insertedCharacter.funds).toBe(50_000);
    expect(insertedCharacter.cashOnHand).toBe(2_500_000 + 500_000);
    expect(insertedCharacter.donorBaseLevel).toBe(1);

    // Post-forex: referrer reward uses two updateOne calls:
    //   1) $inc with actions + buildPersonalBalanceInc (currencyBalances.personal.USD)
    //   2) $set actions cap via $min aggregation
    expect(charactersUpdateOne).toHaveBeenCalledWith(
      { _id: referrerCharacterId },
      expect.objectContaining({
        $inc: expect.objectContaining({
          actions: 10,
        }),
      })
    );
    const firstCall = charactersUpdateOne.mock.calls.find(
      (call: any) => call[1]?.$inc?.actions === 10
    );
    expect(firstCall).toBeDefined();
    const referrerInc = firstCall![1].$inc;
    expect(referrerInc.funds).toBeUndefined();
    // cashOnHand is only present when forex is disabled; with forex it's currencyBalances.personal.USD
    if (referrerInc.cashOnHand !== undefined) {
      expect(referrerInc.cashOnHand).toBe(500_000);
    } else {
      expect(referrerInc["currencyBalances.personal.USD"]).toBe(500_000);
    }
    // Second call caps actions
    expect(charactersUpdateOne).toHaveBeenCalledWith({ _id: referrerCharacterId }, [
      { $set: { actions: { $min: [expect.any(Number), "$actions"] } } },
    ]);

    expect(usersUpdateOne).toHaveBeenCalledWith(
      { _id: referredById },
      { $inc: expect.objectContaining({ referralCount: 1 }) }
    );
  });

  it("returns 409 when character already exists", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const mockStateDoc = {
      _id: "CA",
      name: "California",
      countryId: "US",
    };

    const mockUserDoc = {
      _id: new ObjectId(mockUserId),
      activeCharacterCount: 1,
      isAdmin: false,
    };

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "states") {
          return {
            // `loadUsPoliticalStateIds` reads admitted states with find().
            // Empty is faithful for these fixtures: the home states they use
            // carry house seats for the preset, so admission is not what gates
            // them.
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            findOne: vi.fn().mockResolvedValue(mockStateDoc),
          };
        }
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue(mockUserDoc),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    };

    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { POST } = await import("../character/route");
    const req = new Request("http://localhost/api/auth/character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "John Smith",
        homeState: "CA",
        countryId: "US",
        party: "democrat",
        policies: { economic: -2, social: -1 },
        demographics: {
          race: "white",
          gender: "male",
          education: "college",
          wealth: "middle",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toContain("already");
  });

  it("repairs the legacy unique userId index for admin multi-character creation", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const mockStateDoc = {
      _id: "CA",
      name: "California",
      countryId: "US",
    };

    const mockGameConfig = {
      _id: "default",
      startingFunds: 50000,
      startingActions: 3,
      startingPoliticalInfluence: 0,
      startingFavorability: 50,
      startingInfamy: 0,
      startingDonorBaseLevel: 1,
      testMode: false,
    };

    const mockUser = {
      _id: new ObjectId(mockUserId),
      username: "adminuser",
      activeCharacterCount: 1,
      isAdmin: true,
      hasCompletedSetup: true,
    };

    const insertedId = new ObjectId();
    const legacyUserIdDuplicate = new MongoServerError({
      message: "E11000 duplicate key error collection: characters index: characters_userId dup key",
      code: 11000,
      keyPattern: { userId: 1 },
    });
    const charactersInsertOne = vi
      .fn()
      .mockRejectedValueOnce(legacyUserIdDuplicate)
      .mockResolvedValueOnce({
        insertedId,
        acknowledged: true,
      });
    const charactersIndexes = vi.fn().mockResolvedValue([
      { name: "_id_", key: { _id: 1 } },
      { name: "characters_userId", key: { userId: 1 }, unique: true },
    ]);
    const charactersDropIndex = vi.fn().mockResolvedValue({ ok: 1 });
    const charactersCreateIndex = vi.fn().mockResolvedValue("characters_userId");
    const usersUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "states") {
          return {
            // `loadUsPoliticalStateIds` reads admitted states with find().
            // Empty is faithful for these fixtures: the home states they use
            // carry house seats for the preset, so admission is not what gates
            // them.
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            findOne: vi.fn().mockResolvedValue(mockStateDoc),
          };
        }
        if (name === "characters") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
            insertOne: charactersInsertOne,
            indexes: charactersIndexes,
            dropIndex: charactersDropIndex,
            createIndex: charactersCreateIndex,
          };
        }
        if (name === "gameConfig") {
          return {
            findOne: vi.fn().mockResolvedValue(mockGameConfig),
          };
        }
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue(mockUser),
            updateOne: usersUpdateOne,
          };
        }
        if (name === "adminLogs") {
          return {
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          };
        }
        if (name === "counters") {
          return {
            findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
        };
      }),
    };

    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { POST } = await import("../character/route");
    const req = new Request("http://localhost/api/auth/character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Danica Roem",
        homeState: "CA",
        countryId: "US",
        party: "democrat",
        policies: { economic: -2, social: -1 },
        demographics: {
          race: "white",
          gender: "female",
          education: "college",
          wealth: "middle",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(charactersIndexes).toHaveBeenCalledTimes(1);
    expect(charactersDropIndex).toHaveBeenCalledWith("characters_userId");
    expect(charactersCreateIndex).toHaveBeenCalledWith(
      { userId: 1 },
      { name: "characters_userId" }
    );
    expect(charactersInsertOne).toHaveBeenCalledTimes(2);
  });

  it("reuses an existing non-unique userId index when the legacy unique index used a different name", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const mockStateDoc = {
      _id: "CA",
      name: "California",
      countryId: "US",
    };

    const mockGameConfig = {
      _id: "default",
      startingFunds: 50000,
      startingActions: 3,
      startingPoliticalInfluence: 0,
      startingFavorability: 50,
      startingInfamy: 0,
      startingDonorBaseLevel: 1,
      testMode: false,
    };

    const mockUser = {
      _id: new ObjectId(mockUserId),
      username: "adminuser",
      activeCharacterCount: 1,
      isAdmin: true,
      hasCompletedSetup: true,
    };

    const insertedId = new ObjectId();
    const legacyUserIdDuplicate = new MongoServerError({
      message:
        "E11000 duplicate key error collection: characters index: characters_userId_unique dup key",
      code: 11000,
      keyPattern: { userId: 1 },
    });
    const charactersInsertOne = vi
      .fn()
      .mockRejectedValueOnce(legacyUserIdDuplicate)
      .mockResolvedValueOnce({
        insertedId,
        acknowledged: true,
      });
    const charactersIndexes = vi.fn().mockResolvedValue([
      { name: "_id_", key: { _id: 1 } },
      { name: "userId_1", key: { userId: 1 } },
      { name: "characters_userId_unique", key: { userId: 1 }, unique: true },
    ]);
    const charactersDropIndex = vi.fn().mockResolvedValue({ ok: 1 });
    const charactersCreateIndex = vi.fn().mockResolvedValue("characters_userId");
    const usersUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "states") {
          return {
            // `loadUsPoliticalStateIds` reads admitted states with find().
            // Empty is faithful for these fixtures: the home states they use
            // carry house seats for the preset, so admission is not what gates
            // them.
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            findOne: vi.fn().mockResolvedValue(mockStateDoc),
          };
        }
        if (name === "characters") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
            insertOne: charactersInsertOne,
            indexes: charactersIndexes,
            dropIndex: charactersDropIndex,
            createIndex: charactersCreateIndex,
          };
        }
        if (name === "gameConfig") {
          return {
            findOne: vi.fn().mockResolvedValue(mockGameConfig),
          };
        }
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue(mockUser),
            updateOne: usersUpdateOne,
          };
        }
        if (name === "adminLogs") {
          return {
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          };
        }
        if (name === "counters") {
          return {
            findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
        };
      }),
    };

    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { POST } = await import("../character/route");
    const req = new Request("http://localhost/api/auth/character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Danica Roem",
        homeState: "CA",
        countryId: "US",
        party: "democrat",
        policies: { economic: -2, social: -1 },
        demographics: {
          race: "white",
          gender: "female",
          education: "college",
          wealth: "middle",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(charactersIndexes).toHaveBeenCalledTimes(1);
    expect(charactersDropIndex).toHaveBeenCalledWith("characters_userId_unique");
    expect(charactersCreateIndex).not.toHaveBeenCalled();
    expect(charactersInsertOne).toHaveBeenCalledTimes(2);
  });

  it("does not mask unrelated duplicate-key failures as a userId conflict", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const mockStateDoc = {
      _id: "CA",
      name: "California",
      countryId: "US",
    };

    const mockGameConfig = {
      _id: "default",
      startingFunds: 50000,
      startingActions: 3,
      startingPoliticalInfluence: 0,
      startingFavorability: 50,
      startingInfamy: 0,
      startingDonorBaseLevel: 1,
      testMode: false,
    };

    const mockUser = {
      _id: new ObjectId(mockUserId),
      username: "adminuser",
      activeCharacterCount: 1,
      isAdmin: true,
      hasCompletedSetup: true,
    };

    const duplicateSequentialId = new MongoServerError({
      message: "E11000 duplicate key error collection: characters index: sequentialId_1 dup key",
      code: 11000,
      keyPattern: { sequentialId: 1 },
    });
    const charactersInsertOne = vi.fn().mockRejectedValue(duplicateSequentialId);
    const charactersIndexes = vi.fn().mockResolvedValue([
      { name: "_id_", key: { _id: 1 } },
      { name: "userId_1", key: { userId: 1 } },
    ]);
    const charactersDropIndex = vi.fn().mockResolvedValue({ ok: 1 });
    const charactersCreateIndex = vi.fn().mockResolvedValue("characters_userId");

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "states") {
          return {
            // `loadUsPoliticalStateIds` reads admitted states with find().
            // Empty is faithful for these fixtures: the home states they use
            // carry house seats for the preset, so admission is not what gates
            // them.
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            findOne: vi.fn().mockResolvedValue(mockStateDoc),
          };
        }
        if (name === "characters") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
            insertOne: charactersInsertOne,
            indexes: charactersIndexes,
            dropIndex: charactersDropIndex,
            createIndex: charactersCreateIndex,
          };
        }
        if (name === "gameConfig") {
          return {
            findOne: vi.fn().mockResolvedValue(mockGameConfig),
          };
        }
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue(mockUser),
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          };
        }
        if (name === "adminLogs") {
          return {
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          };
        }
        if (name === "counters") {
          return {
            findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
        };
      }),
    };

    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { POST } = await import("../character/route");
    const req = new Request("http://localhost/api/auth/character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Danica Roem",
        homeState: "CA",
        countryId: "US",
        party: "democrat",
        policies: { economic: -2, social: -1 },
        demographics: {
          race: "white",
          gender: "female",
          education: "college",
          wealth: "middle",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(charactersIndexes).not.toHaveBeenCalled();
    expect(charactersDropIndex).not.toHaveBeenCalled();
    expect(charactersCreateIndex).not.toHaveBeenCalled();
    expect(charactersInsertOne).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when not authenticated", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined), // No token
      set: vi.fn(),
    } as any);

    const { POST } = await import("../character/route");
    const req = new Request("http://localhost/api/auth/character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "John Smith",
        homeState: "CA",
        countryId: "US",
        party: "democrat",
        policies: { economic: -2, social: -1 },
        demographics: {
          race: "white",
          gender: "male",
          education: "college",
          wealth: "middle",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 and clears the cookie for banned users", async () => {
    const cookieStore = {
      get: vi.fn().mockReturnValue({ value: "mock-token" }),
      set: vi.fn(),
    };
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue(cookieStore as any);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: new ObjectId(mockUserId),
              username: "banneduser",
              isBanned: true,
            }),
          };
        }
        return { findOne: vi.fn().mockResolvedValue(null) };
      }),
    } as any);

    const { POST } = await import("../character/route");
    const req = new Request("http://localhost/api/auth/character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "John Smith",
        homeState: "CA",
        countryId: "US",
        party: "democrat",
        policies: { economic: -2, social: -1 },
        demographics: {
          race: "white",
          gender: "male",
          education: "college",
          wealth: "middle",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(cookieStore.set).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      "",
      expect.objectContaining({ maxAge: 0 })
    );
  });
});

describe("GET /api/auth/character - Active character resolution", () => {
  const mockUserId = new ObjectId().toString();

  beforeEach(async () => {
    vi.clearAllMocks();

    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "mock-token" }),
      set: vi.fn(),
    } as any);

    const { jwtVerify } = await import("jose");
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        userId: mockUserId,
        email: "test@example.com",
        username: "testuser",
        role: "player",
        isAdmin: false,
        iat: Math.floor(Date.now() / 1000),
      },
    } as any);
  });

  it("returns the character pinned by activeCharacterId for multi-character accounts", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const activeId = new ObjectId();
    const otherId = new ObjectId();
    const mockUser = {
      _id: new ObjectId(mockUserId),
      activeCharacterId: activeId,
    };
    const activeChar = {
      _id: activeId,
      userId: new ObjectId(mockUserId),
      name: "Test character",
      countryId: "JP",
    };
    const otherChar = {
      _id: otherId,
      userId: new ObjectId(mockUserId),
      name: "Nicola Sturgeon",
      countryId: "UK",
    };

    const charactersFindOne = vi.fn().mockImplementation((query: any) => {
      // Match the active-character scoping
      if (query._id?.toString?.() === activeId.toString()) return Promise.resolve(activeChar);
      // Fallback userId-only would return the first inserted (other) — would expose the bug
      return Promise.resolve(otherChar);
    });

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "users") return { findOne: vi.fn().mockResolvedValue(mockUser) };
        if (name === "characters") return { findOne: charactersFindOne };
        return { findOne: vi.fn().mockResolvedValue(null) };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { GET } = await import("../character/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Test character");
    expect(json.countryId).toBe("JP");
  });

  it("falls back to first character when activeCharacterId is unset", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const onlyChar = {
      _id: new ObjectId(),
      userId: new ObjectId(mockUserId),
      name: "Solo character",
      countryId: "US",
    };
    const mockUser = { _id: new ObjectId(mockUserId) }; // no activeCharacterId

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "users") return { findOne: vi.fn().mockResolvedValue(mockUser) };
        if (name === "characters") {
          return { findOne: vi.fn().mockResolvedValue(onlyChar) };
        }
        return { findOne: vi.fn().mockResolvedValue(null) };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { GET } = await import("../character/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Solo character");
  });

  it("returns 404 when the user has no characters", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "users")
          return { findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(mockUserId) }) };
        if (name === "characters") return { findOne: vi.fn().mockResolvedValue(null) };
        return { findOne: vi.fn().mockResolvedValue(null) };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { GET } = await import("../character/route");
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns 401 when no auth cookie is present", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
    } as any);

    const { GET } = await import("../character/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 401 and clears the cookie for banned users", async () => {
    const cookieStore = {
      get: vi.fn().mockReturnValue({ value: "mock-token" }),
      set: vi.fn(),
    };
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue(cookieStore as any);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: new ObjectId(mockUserId),
              username: "banneduser",
              isBanned: true,
            }),
          };
        }
        return { findOne: vi.fn().mockResolvedValue(null) };
      }),
    } as any);

    const { GET } = await import("../character/route");
    const res = await GET();
    expect(res.status).toBe(401);
    expect(cookieStore.set).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      "",
      expect.objectContaining({ maxAge: 0 })
    );
  });
});
