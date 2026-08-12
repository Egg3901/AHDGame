import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, MongoServerError } from "mongodb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));

vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
  ELECTION_LIMITS: { maxRequests: 10, windowMs: 60000 },
}));

vi.mock("@/lib/currency/characterFunds", async () => {
  const actual = await vi.importActual("@/lib/currency/characterFunds");
  return {
    ...actual,
    loadCharacterFxRate: vi.fn().mockResolvedValue({ rate: 1 }),
    getHomeCurrency: vi.fn().mockReturnValue("USD"),
  };
});

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi.fn().mockImplementation(async (tx) => {
    const mockSession = {} as never;
    await tx(mockSession);
  }),
}));

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn(),
  invalidateGameTimeCache: vi.fn(),
}));

describe("POST /api/political-operations/state-org/build", () => {
  const mockUserId = new ObjectId().toString();
  const mockCharacterId = new ObjectId();
  const turnStart = new Date("2026-06-30T12:00:00.000Z");

  const baseCharacter = {
    _id: mockCharacterId,
    userId: new ObjectId(mockUserId),
    name: "Builder",
    countryId: "US",
    homeState: "PA",
    party: "democrat",
    actions: 10,
    funds: 1_000_000,
  };

  type MockCollections = Record<
    string,
    {
      findOne?: ReturnType<typeof vi.fn>;
      find?: ReturnType<typeof vi.fn>;
      updateOne?: ReturnType<typeof vi.fn>;
      findOneAndUpdate?: ReturnType<typeof vi.fn>;
    }
  >;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: mockUserId,
        username: "builder",
        email: "a@b.c",
        role: "user",
        isAdmin: false,
        hasCharacter: true,
        character: { ...baseCharacter },
      },
    } as never);
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);

    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 100,
      lastTurnProcessed: turnStart,
      isActive: true,
      pausedAt: null,
      effectiveNow: turnStart,
      startingYear: 2019,
    });
  });

  async function setupDb(collections: MockCollections) {
    const { getDb } = await import("@/lib/mongodb");
    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        return (
          collections[name] ?? {
            findOne: vi.fn().mockResolvedValue(null),
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
            // The default handle needs `find` too: the route now reads admitted
            // states through it, and a collection the fixture never named would
            // otherwise throw and turn every expected 4xx into a 500.
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([]),
              project: vi.fn().mockReturnThis(),
              sort: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
            }),
          }
        );
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as never);
    return mockDb;
  }

  it("returns 403 when the character is not US", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: mockUserId,
        username: "uk",
        email: "a@b.c",
        role: "user",
        isAdmin: false,
        hasCharacter: true,
        character: { ...baseCharacter, countryId: "UK" },
      },
    } as never);
    await setupDb({});

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/political-operations/state-org/build", {
        method: "POST",
        body: JSON.stringify({ stateId: "PA" }),
      })
    );
    expect(response.status).toBe(403);
  });

  it("returns 400 for an unknown US state code", async () => {
    await setupDb({});

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/political-operations/state-org/build", {
        method: "POST",
        body: JSON.stringify({ stateId: "ZZ" }),
      })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when the character has insufficient actions", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: mockUserId,
        username: "broke",
        email: "a@b.c",
        role: "user",
        isAdmin: false,
        hasCharacter: true,
        character: { ...baseCharacter, actions: 1 },
      },
    } as never);
    await setupDb({
      characters: {
        findOne: vi.fn().mockResolvedValue({ ...baseCharacter, actions: 1 }),
      },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/political-operations/state-org/build", {
        method: "POST",
        body: JSON.stringify({ stateId: "PA" }),
      })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/actions/i);
  });

  it("increments level on success and debits actions + funds (pre-forex)", async () => {
    const orgFindOneAndUpdate = vi.fn().mockResolvedValue({
      _id: new ObjectId(),
      characterId: mockCharacterId,
      stateId: "PA",
      level: 1,
      totalInvested: 3,
      updatedAt: new Date(),
    });
    const orgFindOnePostRead = vi.fn().mockResolvedValue({
      _id: new ObjectId(),
      characterId: mockCharacterId,
      stateId: "PA",
      level: 1,
      totalInvested: 3,
    });
    const charUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const charFindOne = vi.fn().mockResolvedValue({ ...baseCharacter });

    await setupDb({
      characterStateOrg: {
        findOne: orgFindOnePostRead,
        findOneAndUpdate: orgFindOneAndUpdate,
      },
      characters: { findOne: charFindOne, updateOne: charUpdateOne },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/political-operations/state-org/build", {
        method: "POST",
        body: JSON.stringify({ stateId: "PA" }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.level).toBe(1);
    expect(body.totalInvested).toBe(3);

    // characters debit — pre-forex uses the legacy `funds` field.
    const charCall = charUpdateOne.mock.calls[0];
    expect(charCall[0]).toMatchObject({
      _id: mockCharacterId,
      actions: { $gte: 3 },
      funds: { $gte: 50_000 },
    });
    expect(charCall[1].$inc).toMatchObject({
      actions: -3,
      funds: -50_000,
    });

    // Atomic findOneAndUpdate carries the throttle + cap guards and uses $inc
    // so two parallel requests cannot bypass the throttle.
    expect(orgFindOneAndUpdate).toHaveBeenCalled();
    const orgCall = orgFindOneAndUpdate.mock.calls[0];
    expect(orgCall[0]).toMatchObject({ characterId: mockCharacterId, stateId: "PA" });
    expect(orgCall[0].$or).toBeDefined();
    expect(orgCall[1].$inc).toMatchObject({ level: 1, totalInvested: 3 });
    expect(orgCall[2]).toMatchObject({ upsert: true, returnDocument: "after" });
  });

  it("returns 409 (not 500) when the upsert races into an E11000 duplicate key", async () => {
    // A doc already exists for { characterId, stateId } but no longer matches
    // the throttle/level filter, so upsert attempts an insert and the unique
    // index throws E11000. This is the race/throttle loser, not a server error.
    const dupErr = new MongoServerError({
      message:
        "E11000 duplicate key error collection: a-house-divided.characterStateOrg index: characterId_1_stateId_1",
    });
    dupErr.code = 11000;
    dupErr.keyPattern = { characterId: 1, stateId: 1 };

    const orgFindOneAndUpdate = vi.fn().mockRejectedValue(dupErr);
    const charUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const charFindOne = vi.fn().mockResolvedValue({ ...baseCharacter });

    await setupDb({
      characterStateOrg: {
        findOne: vi.fn().mockResolvedValue(null),
        findOneAndUpdate: orgFindOneAndUpdate,
      },
      characters: { findOne: charFindOne, updateOne: charUpdateOne },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/political-operations/state-org/build", {
        method: "POST",
        body: JSON.stringify({ stateId: "PA" }),
      })
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/already built|cap/i);
  });

  it("uses the last processed turn boundary as the throttle cutoff", async () => {
    const orgFindOneAndUpdate = vi.fn().mockResolvedValue({
      _id: new ObjectId(),
      characterId: mockCharacterId,
      stateId: "PA",
      level: 1,
      totalInvested: 3,
      updatedAt: new Date(),
    });
    const charUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const charFindOne = vi.fn().mockResolvedValue({ ...baseCharacter });

    await setupDb({
      characterStateOrg: {
        findOne: vi.fn().mockResolvedValue({
          characterId: mockCharacterId,
          stateId: "PA",
          level: 1,
          totalInvested: 3,
        }),
        findOneAndUpdate: orgFindOneAndUpdate,
      },
      characters: { findOne: charFindOne, updateOne: charUpdateOne },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/political-operations/state-org/build", {
        method: "POST",
        body: JSON.stringify({ stateId: "PA" }),
      })
    );
    expect(response.status).toBe(200);

    const orgCall = orgFindOneAndUpdate.mock.calls[0];
    expect(orgCall[0]).toMatchObject({
      characterId: mockCharacterId,
      stateId: "PA",
    });
    const throttleCondition = orgCall[0].$or?.find(
      (clause: Record<string, unknown>) => clause.updatedAt && (clause.updatedAt as { $lt?: Date }).$lt
    );
    expect(throttleCondition).toBeDefined();
    expect((throttleCondition.updatedAt as { $lt: Date }).$lt.getTime()).toBe(turnStart.getTime());
  });

  it("returns 409 when the existing org doc was already updated this turn", async () => {
    const orgFindOneAndUpdate = vi.fn().mockResolvedValue(null);
    const charUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const charFindOne = vi.fn().mockResolvedValue({ ...baseCharacter });

    await setupDb({
      characterStateOrg: {
        findOne: vi.fn().mockResolvedValue({
          characterId: mockCharacterId,
          stateId: "PA",
          level: 1,
          totalInvested: 3,
          updatedAt: new Date(turnStart.getTime() + 1000),
        }),
        findOneAndUpdate: orgFindOneAndUpdate,
      },
      characters: { findOne: charFindOne, updateOne: charUpdateOne },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/political-operations/state-org/build", {
        method: "POST",
        body: JSON.stringify({ stateId: "PA" }),
      })
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/already built|cap/i);
  });

  it("allows a second build after the turn boundary advances", async () => {
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 101,
      lastTurnProcessed: new Date(turnStart.getTime() + 60 * 60 * 1000),
      isActive: true,
      pausedAt: null,
      effectiveNow: new Date(turnStart.getTime() + 60 * 60 * 1000),
      startingYear: 2019,
    });

    const orgFindOneAndUpdate = vi.fn().mockResolvedValue({
      _id: new ObjectId(),
      characterId: mockCharacterId,
      stateId: "PA",
      level: 2,
      totalInvested: 6,
      updatedAt: new Date(),
    });
    const orgFindOnePostRead = vi.fn().mockResolvedValue({
      characterId: mockCharacterId,
      stateId: "PA",
      level: 2,
      totalInvested: 6,
    });
    const charUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const charFindOne = vi.fn().mockResolvedValue({ ...baseCharacter });

    await setupDb({
      characterStateOrg: {
        findOne: orgFindOnePostRead,
        findOneAndUpdate: orgFindOneAndUpdate,
      },
      characters: { findOne: charFindOne, updateOne: charUpdateOne },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/political-operations/state-org/build", {
        method: "POST",
        body: JSON.stringify({ stateId: "PA" }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.level).toBe(2);
  });
});
