import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Character } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/time/gameTime", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/time/gameTime")>()),
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 100,
    effectiveNow: new Date(),
    lastTurnProcessed: new Date(),
    isActive: true,
    pausedAt: null,
  }),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/currency/characterFunds", () => ({
  getHomeCurrency: vi.fn().mockReturnValue("USD"),
  loadCharacterFxRate: vi.fn().mockResolvedValue({ rate: 1 }),
}));
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi.fn(async (_withSession, fallback) => {
    await fallback();
  }),
}));
vi.mock("@/lib/db/collections", () => ({
  getStateDemographicTurnoutCollection: vi.fn(),
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/canvassing", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function authedCharacter(overrides: Partial<Character> = {}): Character {
  return {
    _id: new ObjectId(),
    homeState: "GA",
    actions: 5,
    funds: 10_000,
    policies: { economic: 0, social: 0 },
    ...overrides,
  } as Character;
}

describe("POST /api/canvassing — eligibility", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electionCandidates").find.mockReturnValue({
      toArray: () => Promise.resolve([]),
    });
    // characters.updateOne returns a successful spend by default
    db.collection("characters").updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    const turnoutCollection = {
      findOne: vi.fn().mockResolvedValue({
        _id: "GA",
        modifiers: { race: { white: 0 } },
        lastUpdated: new Date(),
      }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { getStateDemographicTurnoutCollection } = await import("@/lib/db/collections");
    vi.mocked(getStateDemographicTurnoutCollection).mockResolvedValue(turnoutCollection as never);
  });

  it("returns 403 when a presidential candidate has no primaryCampaignState set in the primary phase", async () => {
    const character = authedCharacter();
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const electionId = new ObjectId();
    db.collection("electionCandidates").find.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          {
            _id: new ObjectId(),
            electionId,
            characterId: character._id,
            status: "active",
          },
        ]),
    });
    db.collection("elections").find.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          {
            _id: electionId,
            electionType: "president",
            status: "active",
            primaryEndTime: future,
          },
        ]),
    });
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "u1", character },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ stateId: "TX", category: "race", group: "white", count: 1 }) as never
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Set your primary campaign state to canvass voters there");
  });

  it("returns 403 when a presidential candidate has no travelState set in the general phase", async () => {
    const character = authedCharacter();
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const electionId = new ObjectId();
    db.collection("electionCandidates").find.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          {
            _id: new ObjectId(),
            electionId,
            characterId: character._id,
            status: "active",
          },
        ]),
    });
    db.collection("elections").find.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          {
            _id: electionId,
            electionType: "president",
            status: "active",
            primaryEndTime: past,
          },
        ]),
    });
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "u1", character },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ stateId: "TX", category: "race", group: "white", count: 1 }) as never
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Travel to a state to canvass voters there");
  });

  it("returns 403 when stateId does not match the eligible state", async () => {
    const character = authedCharacter({ homeState: "GA" });
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "u1", character },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ stateId: "TX", category: "race", group: "white", count: 1 }) as never
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("You can only canvass in your active campaign state");
  });

  it("allows a non-candidate to canvass in their home state (regression)", async () => {
    const character = authedCharacter({ homeState: "GA" });
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "u1", character },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ stateId: "GA", category: "race", group: "white", count: 1 }) as never
    );

    expect(res.status).toBe(200);
  });

  it("allows a presidential candidate to canvass in their travelState", async () => {
    const character = authedCharacter({ homeState: "GA" });
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const electionId = new ObjectId();
    db.collection("electionCandidates").find.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          {
            _id: new ObjectId(),
            electionId,
            characterId: character._id,
            status: "active",
            travelState: "TX",
          },
        ]),
    });
    db.collection("elections").find.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          {
            _id: electionId,
            electionType: "president",
            status: "active",
            primaryEndTime: past,
          },
        ]),
    });
    const turnoutCollection = {
      findOne: vi.fn().mockResolvedValue({
        _id: "TX",
        modifiers: { race: { white: 0 } },
        lastUpdated: new Date(),
      }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const { getStateDemographicTurnoutCollection } = await import("@/lib/db/collections");
    vi.mocked(getStateDemographicTurnoutCollection).mockResolvedValue(turnoutCollection as never);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "u1", character },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ stateId: "TX", category: "race", group: "white", count: 1 }) as never
    );

    expect(res.status).toBe(200);
  });
});

describe("POST /api/canvassing — country-aware groups", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electionCandidates").find.mockReturnValue({
      toArray: () => Promise.resolve([]),
    });
    db.collection("characters").updateOne.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("writes a JP canvass to modifiers.jp_voterGroups.<group>", async () => {
    const character = authedCharacter({ homeState: "JP-13", countryId: "JP" } as never);
    const turnoutUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const turnoutCollection = {
      findOne: vi.fn().mockResolvedValue({
        _id: "JP-13",
        modifiers: { jp_voterGroups: {} },
        lastUpdated: new Date(),
      }),
      updateOne: turnoutUpdateOne,
    };
    const { getStateDemographicTurnoutCollection } = await import("@/lib/db/collections");
    vi.mocked(getStateDemographicTurnoutCollection).mockResolvedValue(turnoutCollection as never);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "u1", character },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        stateId: "JP-13",
        category: "jp_voterGroups",
        group: "komeito_faithful",
        count: 1,
      }) as never
    );

    expect(res.status).toBe(200);
    const updateArg = turnoutUpdateOne.mock.calls[0][1];
    expect(Object.keys(updateArg.$set)).toContain("modifiers.jp_voterGroups.komeito_faithful");
  });

  it("rejects a UK group id submitted by a JP character", async () => {
    const character = authedCharacter({ homeState: "JP-13", countryId: "JP" } as never);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "u1", character },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        stateId: "JP-13",
        category: "jp_voterGroups",
        group: "new_britons",
        count: 1,
      }) as never
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid demographic group");
  });
});
