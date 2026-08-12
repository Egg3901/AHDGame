/**
 * Forex unit-invariant tests for character creation.
 * Verifies that wealthBonus is converted to home currency using INITIAL_RATES,
 * and that displayCurrencyPreference defaults to "local" when forex is enabled.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
}));

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 42, effectiveNow: new Date() }),
}));

const mockUserId = new ObjectId().toString();

function makeDb() {
  const insertedId = new ObjectId();
  const insertOne = vi.fn().mockResolvedValue({ insertedId, acknowledged: true });

  const db = {
    insertOne,
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "states") {
        return {
          // `loadUsPoliticalStateIds` reads admitted states with find().
          // Empty is faithful for these fixtures: the home states they use
          // carry house seats for the preset, so admission is not what gates
          // them.
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          findOne: vi.fn().mockResolvedValue({
            _id: "jp_tokyo",
            name: "Tokyo",
            countryId: "JP",
          }),
        };
      }
      if (name === "gameConfig") {
        return {
          findOne: vi.fn().mockResolvedValue({
            _id: "default",
            startingFunds: 50_000,
            startingActions: 3,
            startingPoliticalInfluence: 0,
            startingFavorability: 50,
            startingInfamy: 0,
            startingDonorBaseLevel: 1,
          }),
        };
      }
      if (name === "users") {
        return {
          findOne: vi.fn().mockResolvedValue({
            _id: new ObjectId(mockUserId),
            username: "testuser",
            hasCompletedSetup: false,
            activeCharacterCount: 0,
          }),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        };
      }
      if (name === "characters") {
        return {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne,
        };
      }
      if (name === "counters") {
        return {
          findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }),
        };
      }
      if (name === "adminLogs") {
        return {
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
        };
      }
      // Default: countryGameStates returns null → falls back to config (JP is active)
      return {
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
      };
    }),
  };
  return { db, insertOne };
}

describe("POST /api/auth/character — forex enabled (JP)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "mock-token" }),
      set: vi.fn(),
    } as never);

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
    } as never);
  });

  it("converts middle wealthBonus to JPY using INITIAL_RATES", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { db, insertOne } = makeDb();
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { POST } = await import("../character/route");
    const req = new Request("http://localhost/api/auth/character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Tanaka Test",
        homeState: "jp_tokyo",
        countryId: "JP",
        party: "ldp",
        policies: { economic: 1, social: 1 },
        demographics: {
          race: "asian",
          gender: "male",
          education: "college",
          wealth: "middle",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const inserted = insertOne.mock.calls[0][0];
    // wealthBonus = 2_500_000 ₳; INITIAL_RATES.JP = 106 → ¥265_000_000
    expect(inserted.currencyBalances?.personal?.JPY).toBe(265_000_000);
    expect(inserted.displayCurrencyPreference).toBe("local");
    expect(inserted.autoConvertEnabled).toBe(true);
  });

  it("converts high wealthBonus to JPY using INITIAL_RATES", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { db, insertOne } = makeDb();
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { POST } = await import("../character/route");
    const req = new Request("http://localhost/api/auth/character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Tanaka Rich",
        homeState: "jp_tokyo",
        countryId: "JP",
        party: "ldp",
        policies: { economic: 1, social: 1 },
        demographics: {
          race: "asian",
          gender: "female",
          education: "graduate",
          wealth: "high",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const inserted = insertOne.mock.calls[0][0];
    // wealthBonus = 5_000_000 ₳; INITIAL_RATES.JP = 106 → ¥530_000_000
    expect(inserted.currencyBalances?.personal?.JPY).toBe(530_000_000);
    expect(inserted.displayCurrencyPreference).toBe("local");
  });

  it("US character: wealthBonus unchanged (rate = 1.0)", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { db, insertOne } = makeDb();
    // Override states mock to return US state
    db.collection.mockImplementation((name: string) => {
      if (name === "states") {
        return {
          // `loadUsPoliticalStateIds` reads admitted states with find().
          // Empty is faithful for these fixtures: the home states they use
          // carry house seats for the preset, so admission is not what gates
          // them.
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          findOne: vi.fn().mockResolvedValue({
            _id: "CA",
            name: "California",
            countryId: "US",
          }),
        };
      }
      if (name === "gameConfig") {
        return {
          findOne: vi.fn().mockResolvedValue({
            _id: "default",
            startingFunds: 50_000,
            startingActions: 3,
            startingPoliticalInfluence: 0,
            startingFavorability: 50,
            startingInfamy: 0,
            startingDonorBaseLevel: 1,
          }),
        };
      }
      if (name === "users") {
        return {
          findOne: vi.fn().mockResolvedValue({
            _id: new ObjectId(mockUserId),
            username: "testuser",
            activeCharacterCount: 0,
          }),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        };
      }
      if (name === "characters") {
        return { findOne: vi.fn().mockResolvedValue(null), insertOne };
      }
      if (name === "counters") {
        return { findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }) };
      }
      if (name === "adminLogs") {
        return { updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }) };
      }
      return {
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
      };
    });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { POST } = await import("../character/route");
    const req = new Request("http://localhost/api/auth/character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "John Smith",
        homeState: "CA",
        countryId: "US",
        party: "democrat",
        policies: { economic: -1, social: -1 },
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

    const inserted = insertOne.mock.calls[0][0];
    // wealthBonus = 2_500_000 ₳; INITIAL_RATES.US = 1.0 → $2_500_000
    expect(inserted.currencyBalances?.personal?.USD).toBe(2_500_000);
    expect(inserted.displayCurrencyPreference).toBe("local");
  });
});
