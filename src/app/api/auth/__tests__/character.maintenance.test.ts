/**
 * Maintenance gating for character creation.
 *
 * `src/proxy.ts` returns early for `/api/*`, so the proxy's maintenance
 * redirect never covers this route. These tests pin the route-level guard:
 * non-admins are blocked while `gameConfig.maintenanceMode` is set, admins
 * still get through so they can verify a freshly-reset world.
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

vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 42, effectiveNow: new Date() }),
}));

const mockUserId = new ObjectId().toString();

const BASE_GAME_CONFIG = {
  _id: "default",
  startingFunds: 50000,
  startingActions: 3,
  startingPoliticalInfluence: 0,
  startingFavorability: 50,
  startingInfamy: 0,
  startingDonorBaseLevel: 1,
};

/** Build a mock db whose gameConfig/user reflect the scenario under test. */
function buildMockDb(options: {
  maintenanceMode: boolean | "off" | "partial" | "full";
  isAdmin: boolean;
}) {
  const charactersInsertOne = vi.fn().mockResolvedValue({
    insertedId: new ObjectId(),
    acknowledged: true,
  });

  const db = {
    collection: vi.fn().mockImplementation((name: string) => {
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
      if (name === "characters") {
        return {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: charactersInsertOne,
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        };
      }
      if (name === "gameConfig") {
        return {
          findOne: vi
            .fn()
            .mockResolvedValue({ ...BASE_GAME_CONFIG, maintenanceMode: options.maintenanceMode }),
        };
      }
      if (name === "users") {
        return {
          findOne: vi.fn().mockResolvedValue({
            _id: new ObjectId(mockUserId),
            username: "testuser",
            hasCompletedSetup: false,
            isAdmin: options.isAdmin,
          }),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        };
      }
      if (name === "adminLogs") {
        return { updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }) };
      }
      if (name === "counters") {
        return { findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }) };
      }
      return {
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
      };
    }),
  };

  return { db, charactersInsertOne };
}

function creationRequest(): Request {
  return new Request("http://localhost/api/auth/character", {
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
}

describe("POST /api/auth/character - maintenance gating", () => {
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

  it("blocks a non-admin with 503 and writes nothing while maintenance is on", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { db, charactersInsertOne } = buildMockDb({ maintenanceMode: true, isAdmin: false });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { POST } = await import("../character/route");
    const res = await POST(creationRequest());

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/maintenance/i);
    // The guard must short-circuit before the character is persisted.
    expect(charactersInsertOne).not.toHaveBeenCalled();
  }, 15_000);

  it("still lets an admin create a character while maintenance is on", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { db, charactersInsertOne } = buildMockDb({ maintenanceMode: true, isAdmin: true });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { POST } = await import("../character/route");
    const res = await POST(creationRequest());

    expect(res.status).toBe(201);
    expect(charactersInsertOne).toHaveBeenCalled();
  }, 15_000);

  it("lets a non-admin create a character when maintenance is off", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { db, charactersInsertOne } = buildMockDb({ maintenanceMode: false, isAdmin: false });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { POST } = await import("../character/route");
    const res = await POST(creationRequest());

    expect(res.status).toBe(201);
    expect(charactersInsertOne).toHaveBeenCalled();
  }, 15_000);

  it("blocks a non-admin with 503 while maintenance mode is 'partial' (not just legacy true)", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { db, charactersInsertOne } = buildMockDb({ maintenanceMode: "partial", isAdmin: false });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { POST } = await import("../character/route");
    const res = await POST(creationRequest());

    expect(res.status).toBe(503);
    expect(charactersInsertOne).not.toHaveBeenCalled();
  }, 15_000);

  it("lets a non-admin create a character when maintenance mode is 'off' (tri-state string)", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { db, charactersInsertOne } = buildMockDb({ maintenanceMode: "off", isAdmin: false });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { POST } = await import("../character/route");
    const res = await POST(creationRequest());

    expect(res.status).toBe(201);
    expect(charactersInsertOne).toHaveBeenCalled();
  }, 15_000);
});
