import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { NextRequest } from "next/server";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Character } from "@/lib/db/types";

vi.mock("@/lib/campaignTargeting/audience", () => ({
  loadCampaignAudience: vi.fn().mockResolvedValue(null),
}));

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
vi.mock("@/lib/canvassing/canvassSpend", () => ({
  applyCanvassSpend: vi.fn().mockResolvedValue({ duplicate: false }),
}));
vi.mock("@/lib/db/collections", () => ({
  getStateDemographicTurnoutCollection: vi.fn(),
}));

function makeRequest(body: unknown, idempotencyKey?: string): Request {
  return new Request("http://localhost/api/canvassing", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(idempotencyKey !== undefined ? { "Idempotency-Key": idempotencyKey } : {}),
    },
  });
}

async function spendCall() {
  const { applyCanvassSpend } = await import("@/lib/canvassing/canvassSpend");
  const mock = vi.mocked(applyCanvassSpend);
  if (mock.mock.calls.length === 0) throw new Error("applyCanvassSpend was not called");
  return mock.mock.calls[0][1] as Record<string, unknown>;
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
    const turnoutCollection = {
      findOne: vi.fn().mockResolvedValue({
        _id: "JP-13",
        modifiers: { jp_voterGroups: {} },
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
      makeRequest({
        stateId: "JP-13",
        category: "jp_voterGroups",
        group: "komeito_faithful",
        count: 1,
      }) as never
    );

    expect(res.status).toBe(200);
    const input = await spendCall();
    expect(input.characterId).toEqual(character._id);
    expect(input.totalFundsCostLocal).toBe(100);
    expect(input.totalActionsCost).toBe(1);
    expect(input).not.toHaveProperty("surrogateCampaignId");
    const turnout = input.turnout as Record<string, unknown>;
    expect(turnout.stateId).toBe("JP-13");
    expect(turnout.modifierPath).toBe("modifiers.jp_voterGroups.komeito_faithful");
    expect(turnout.modifierValue).toEqual(expect.any(Number));
    expect(input.fingerprint).toBe(
      `${character._id.toHexString()}:JP-13:jp_voterGroups:komeito_faithful:1`
    );
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

describe("POST /api/canvassing running-mate surrogate branch", () => {
  let db: MockDb;

  // Wire up the character as the running mate on an active general-phase
  // presidential ticket canvassing that ticket's travel state ("PA").
  async function setupMateCanvass() {
    const character = authedCharacter({ homeState: "GA", countryId: "US" } as never);
    const electionId = new ObjectId();
    const nomineeId = new ObjectId();
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const ticketCampaignId = new ObjectId();

    db.collection("electionCandidates").find.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          {
            _id: new ObjectId(),
            electionId,
            characterId: nomineeId,
            status: "active",
            runningMateId: character._id,
            runningMateTravelState: "PA",
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
            endTime: future,
          },
        ]),
    });
    db.collection("campaigns").findOne.mockResolvedValue({ _id: ticketCampaignId });

    const turnoutCollection = {
      findOne: vi.fn().mockResolvedValue({
        _id: "PA",
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
    const { applyCanvassSpend } = await import("@/lib/canvassing/canvassSpend");
    vi.mocked(applyCanvassSpend).mockResolvedValue({ duplicate: false });

    return { character, ticketCampaignId };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { applyCanvassSpend } = await import("@/lib/canvassing/canvassSpend");
    vi.mocked(applyCanvassSpend).mockResolvedValue({ duplicate: false });
  });

  it("passes the ticket pool draw into the shared spend with the canvass count", async () => {
    const { ticketCampaignId } = await setupMateCanvass();
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ stateId: "PA", category: "race", group: "white", count: 2 }) as never
    );

    expect(res.status).toBe(200);
    // The pool draw moved inside the shared flow: the route hands the ticket
    // id and the full count down instead of decrementing the pool itself.
    const input = await spendCall();
    expect(input.surrogateCampaignId).toEqual(ticketCampaignId);
    expect(input.totalActionsCost).toBe(2);
    expect(input.totalFundsCostLocal).toBe(200);
    // The route performs no balance writes of its own anymore.
    expect(db.collection("campaigns").updateOne).not.toHaveBeenCalled();
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("returns 409 and spends nothing when the pool is exhausted", async () => {
    await setupMateCanvass();
    const { applyCanvassSpend } = await import("@/lib/canvassing/canvassSpend");
    vi.mocked(applyCanvassSpend).mockRejectedValueOnce(new Error("SURROGATE_DEPLETED"));
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ stateId: "PA", category: "race", group: "white", count: 1 }) as never
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("No running-mate surrogate actions remaining today.");
    // The route performs no balance writes of its own; the shared flow owns
    // the pool draw and leaves the character untouched when it is dry.
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
    expect(db.collection("campaigns").updateOne).not.toHaveBeenCalled();
  });

  it("maps a raced character spend to 409 without touching the pool itself", async () => {
    await setupMateCanvass();
    const { applyCanvassSpend } = await import("@/lib/canvassing/canvassSpend");
    vi.mocked(applyCanvassSpend).mockRejectedValueOnce(new Error("INSUFFICIENT_RESOURCES"));
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ stateId: "PA", category: "race", group: "white", count: 3 }) as never
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("Your available actions or funds changed. Please try again.");
    // Compensation (including the pool restore) lives in the shared flow now:
    // the route issues no restore write of its own.
    expect(db.collection("campaigns").updateOne).not.toHaveBeenCalled();
  });

  it("forwards Idempotency-Key replays to the shared spend", async () => {
    await setupMateCanvass();
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        { stateId: "PA", category: "race", group: "white", count: 1 },
        "replay-key"
      ) as never
    );

    expect(res.status).toBe(200);
    const input = await spendCall();
    expect(input.idempotencyKey).toBe("replay-key");
  });

  it("rejects an invalid Idempotency-Key before spending", async () => {
    await setupMateCanvass();
    const { applyCanvassSpend } = await import("@/lib/canvassing/canvassSpend");
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        { stateId: "PA", category: "race", group: "white", count: 1 },
        "x".repeat(129)
      ) as never
    );

    expect(res.status).toBe(400);
    expect(vi.mocked(applyCanvassSpend)).not.toHaveBeenCalled();
  });
});

describe("canvassing campaign turnout integration", () => {
  let db: MockDb;
  const payload = { stateId: "GA", category: "race", group: "white", count: 5 };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { applyCanvassSpend } = await import("@/lib/canvassing/canvassSpend");
    vi.mocked(applyCanvassSpend).mockResolvedValue({ duplicate: false });
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "u1", character: authedCharacter({ countryId: "US" }) },
    } as never);
    const turnoutCollection = {
      findOne: vi.fn().mockResolvedValue({
        _id: "GA",
        countryId: "US",
        modifiers: { race: { white: 0 } },
        lastUpdated: new Date(0),
      }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const { getStateDemographicTurnoutCollection } = await import("@/lib/db/collections");
    vi.mocked(getStateDemographicTurnoutCollection).mockResolvedValue(turnoutCollection as never);
    db.collection("states").findOne.mockResolvedValue({
      _id: "GA",
      countryId: "US",
      population: 1_000_000,
      votingEligiblePopulation: 1_000_000,
    });
    db.collection("stateDemographics").findOne.mockResolvedValue({
      _id: "GA",
      countryId: "US",
      categoryWeights: {},
      groups: {},
      lastUpdated: new Date(0),
    });
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current", currentTurn: 100 });
    const { loadCampaignAudience } = await import("@/lib/campaignTargeting/audience");
    const actual = await vi.importActual<typeof import("@/lib/campaignTargeting/audience")>(
      "@/lib/campaignTargeting/audience"
    );
    vi.mocked(loadCampaignAudience).mockImplementation(actual.loadCampaignAudience);
  });

  it.each(["UK", "JP", "DE", "IE", "CN", "BR", "DD"])(
    "rejects a native-only target in a legacy %s race without spending",
    async (countryId) => {
      const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
      vi.mocked(requireAuthWithCharacter).mockResolvedValue({
        ok: true,
        user: {
          userId: "u1",
          character: authedCharacter({ countryId: countryId as Character["countryId"] }),
        },
      } as never);
      db.collection("elections").find.mockReturnValue({
        toArray: async () => [{ _id: new ObjectId(), status: "active" }],
      });
      const { POST } = await import("./route");
      const result = await POST(
        new NextRequest(makeRequest({ ...payload, category: "education", group: "tertiary" }))
      );
      expect(result.status).toBe(400);
      expect((await result.json()).error).toContain("legacy canvassing groups");
      expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
      const { getStateDemographicTurnoutCollection } = await import("@/lib/db/collections");
      expect((await getStateDemographicTurnoutCollection()).updateOne).not.toHaveBeenCalled();
    }
  );

  it.each(["UK", "JP", "DE", "IE", "CN", "BR", "DD"])(
    "still applies original voter-group canvassing in a legacy %s race",
    async (countryId) => {
      const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
      vi.mocked(requireAuthWithCharacter).mockResolvedValue({
        ok: true,
        user: {
          userId: "u1",
          character: authedCharacter({ countryId: countryId as Character["countryId"] }),
        },
      } as never);
      db.collection("elections").find.mockReturnValue({
        toArray: async () => [{ _id: new ObjectId(), status: "active" }],
      });
      const { getDemographicCategoriesForCountry } =
        await import("@/lib/demographics/countryDemographics");
      const category = getDemographicCategoriesForCountry(countryId)[0];
      const { POST } = await import("./route");
      const result = await POST(
        new NextRequest(
          makeRequest({ ...payload, category: category.key, group: category.groups[0].id })
        )
      );
      expect(result.status).toBe(200);
      expect(Number((await result.json()).effect.legacyBoost)).toBeGreaterThan(0);
      const input = await spendCall();
      expect(input.totalFundsCostLocal).toBe(500);
      expect(input.totalActionsCost).toBe(5);
      const turnout = input.turnout as Record<string, unknown>;
      expect(turnout.stateId).toBe("GA");
      expect(turnout.modifierPath).toBe(`modifiers.${category.key}.${category.groups[0].id}`);
      expect(turnout.modifierValue).toEqual(expect.any(Number));
    }
  );

  it("rejects a stale or foreign explicit race before spending", async () => {
    const { POST } = await import("./route");
    const result = await POST(
      new NextRequest(makeRequest({ ...payload, electionId: new ObjectId().toString() }))
    );
    expect(result.status).toBe(400);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("keeps legacy US ideology canvassing available and reports the legacy boost", async () => {
    db.collection("elections").find.mockReturnValue({
      toArray: async () => [{ campaignRulesVersion: undefined }],
    });
    const { getDemographicCategoriesForCountry } =
      await import("@/lib/demographics/countryDemographics");
    const group = getDemographicCategoriesForCountry("US").find(
      (category) => category.key === "ideology"
    )!.groups[0].id;
    const { POST } = await import("./route");
    const result = await POST(
      new NextRequest(makeRequest({ ...payload, category: "ideology", group }))
    );
    expect(result.status).toBe(200);
    const { effect } = await result.json();
    expect(effect.campaignRulesVersion).toBe(0);
    expect(Number(effect.boost)).toBeGreaterThan(0);
    expect(effect.boost).toBe(effect.legacyBoost);
  });

  it("rate-limits previews before deriving any cells", async () => {
    const { checkRateLimit, rateLimitResponse } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValueOnce({ ok: false, retryAfter: 10 } as never);
    vi.mocked(rateLimitResponse).mockReturnValueOnce(
      new (await import("next/server")).NextResponse(null, { status: 429 })
    );
    const { loadCampaignAudience } = await import("@/lib/campaignTargeting/audience");
    const { GET } = await import("./route");
    const result = await GET(new NextRequest("http://localhost/api/canvassing"));
    expect(result.status).toBe(429);
    expect(loadCampaignAudience).not.toHaveBeenCalled();
  });

  it("previews the actual blended turnout and writes both election versions", async () => {
    const { GET, POST } = await import("./route");
    const preview = await GET(
      new NextRequest("http://localhost/api/canvassing?category=race&group=white&count=5")
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("cache-control")).toBe("private, no-store");
    const quote = await preview.json();
    expect(quote.targets).toContainEqual({ dimension: "race", bucket: "white" });
    expect(quote.preview.turnoutAfter).toBeGreaterThan(quote.preview.turnoutBefore);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
    const result = await POST(new NextRequest(makeRequest(payload)));
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.effect.turnoutAfter).toBeCloseTo(quote.preview.turnoutAfter, 6);
    expect(Number(body.effect.boost)).toBeGreaterThan(Number(body.effect.legacyBoost) * 10);
    const input = await spendCall();
    expect(input.totalFundsCostLocal).toBe(500);
    expect(input.totalActionsCost).toBe(5);
    const turnout = input.turnout as Record<string, unknown>;
    expect(turnout).toMatchObject({
      stateId: "GA",
      lastUpdated: new Date(0),
      modifierPath: "modifiers.race.white",
      modifierValue: expect.any(Number),
    });
    expect(turnout.campaignModifiers).toEqual(
      expect.objectContaining({ race: { white: expect.any(Number) } })
    );
  });

  it.each([0, -1, 1.5, 51, "5"])(
    "rejects malformed batch count %s before spending",
    async (count) => {
      const { POST } = await import("./route");
      const response = await POST(new NextRequest(makeRequest({ ...payload, count })));
      expect(response.status).toBe(400);
      expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
    }
  );

  it("maps a raced turnout stamp to 409 with the exact spend shape", async () => {
    const { applyCanvassSpend } = await import("@/lib/canvassing/canvassSpend");
    vi.mocked(applyCanvassSpend).mockRejectedValueOnce(
      new Error("TURNOUT_CONFLICT:guard-rejected")
    );
    const { POST } = await import("./route");
    const response = await POST(new NextRequest(makeRequest(payload)));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(
      "State turnout changed while canvassing. Please refresh and try again."
    );
    // The route hands the full batch cost down; the refund lives in the
    // shared flow, so the route itself issues no compensation write.
    const input = await spendCall();
    expect(input.totalFundsCostLocal).toBe(500);
    expect(input.totalActionsCost).toBe(5);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });
});

describe("POST /api/canvassing — Idempotency-Key replay after balance changes", () => {
  let db: MockDb;

  async function setupReplay(character: Character, receipt: Record<string, unknown> | null) {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "u1", character },
    } as never);
    const turnoutCollection = {
      findOne: vi.fn().mockResolvedValue({
        _id: "GA",
        modifiers: { race: { white: 0 } },
        lastUpdated: new Date(),
      }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const { getStateDemographicTurnoutCollection } = await import("@/lib/db/collections");
    vi.mocked(getStateDemographicTurnoutCollection).mockResolvedValue(turnoutCollection as never);
    db.collection("nonAtomicMoneyFlowReceipts").findOne.mockResolvedValue(receipt);
  }

  function fingerprint(character: Character) {
    return `${character._id.toHexString()}:GA:race:white:1`;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electionCandidates").find.mockReturnValue({
      toArray: () => Promise.resolve([]),
    });
    const { applyCanvassSpend } = await import("@/lib/canvassing/canvassSpend");
    vi.mocked(applyCanvassSpend).mockResolvedValue({ duplicate: false });
  });

  it("replays a completed canvass after funds and actions changed", async () => {
    // The auth snapshot shows a broke character: the first request already
    // spent the batch, so the retry must not fail its own balance checks.
    const character = authedCharacter({ funds: 0, actions: 0 });
    await setupReplay(character, {
      _id: "canvass-1",
      status: "completed",
      fingerprint: fingerprint(character),
    });
    const { applyCanvassSpend } = await import("@/lib/canvassing/canvassSpend");
    vi.mocked(applyCanvassSpend).mockResolvedValue({ duplicate: true });
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        { stateId: "GA", category: "race", group: "white", count: 1 },
        "canvass-1"
      ) as never
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.duplicate).toBe(true);
    // Recovery runs through the shared flow (a no-op duplicate), never
    // through route-owned balance writes.
    expect(vi.mocked(applyCanvassSpend)).toHaveBeenCalledOnce();
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
    expect(db.collection("campaigns").updateOne).not.toHaveBeenCalled();
  });

  it("recovers an interrupted canvass without re-checking balances", async () => {
    const character = authedCharacter({ funds: 0, actions: 0 });
    await setupReplay(character, {
      _id: "canvass-2",
      status: "in_progress",
      fingerprint: fingerprint(character),
    });
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        { stateId: "GA", category: "race", group: "white", count: 1 },
        "canvass-2"
      ) as never
    );

    expect(res.status).toBe(200);
    const input = await spendCall();
    expect(input.idempotencyKey).toBe("canvass-2");
    expect(input.fingerprint).toBe(fingerprint(character));
  });

  it("rejects a key reused for a different canvass", async () => {
    const character = authedCharacter();
    await setupReplay(character, {
      _id: "canvass-3",
      status: "completed",
      fingerprint: "other-fingerprint",
    });
    const { applyCanvassSpend } = await import("@/lib/canvassing/canvassSpend");
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        { stateId: "GA", category: "race", group: "white", count: 1 },
        "canvass-3"
      ) as never
    );

    expect(res.status).toBe(500);
    expect(vi.mocked(applyCanvassSpend)).not.toHaveBeenCalled();
  });
});
