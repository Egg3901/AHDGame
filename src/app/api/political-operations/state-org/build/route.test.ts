import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { stateOrgLevelCost, STATE_ORG_COST_ACTIONS } from "@/lib/electionEngine/constants";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
} from "@/lib/db/nonAtomicMoneyFlow";

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

vi.mock("@/lib/elections/stateOrgBuildSpend", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/elections/stateOrgBuildSpend")>(
      "@/lib/elections/stateOrgBuildSpend"
    );
  return {
    ...actual,
    applyStateOrgBuildSpend: vi.fn(),
  };
});

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn(),
  invalidateGameTimeCache: vi.fn(),
}));

describe("POST /api/political-operations/state-org/build", () => {
  const mockUserId = new ObjectId().toString();
  const mockCharacterId = new ObjectId();
  const mockCampaignId = new ObjectId();
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

  const buildRequest = (body: unknown, headers?: Record<string, string>) =>
    new Request("http://localhost/api/political-operations/state-org/build", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

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

    const { applyStateOrgBuildSpend } = await import("@/lib/elections/stateOrgBuildSpend");
    vi.mocked(applyStateOrgBuildSpend).mockResolvedValue({
      duplicate: false,
      level: 1,
      totalInvested: STATE_ORG_COST_ACTIONS,
    });
  });

  /**
   * Campaign Presence is funded from the CAMPAIGN's pools, so every success
   * path needs a campaign fixture. Generous defaults so tests that are not
   * about affordability never trip the gate.
   */
  const campaignFixture = (over: Record<string, unknown> = {}) => ({
    findOne: vi.fn().mockResolvedValue({
      _id: mockCampaignId,
      actions: 50,
      funds: 100_000_000,
      ...over,
    }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
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

  async function setupSuccessOrg(level = 0) {
    await setupDb({
      characters: { findOne: vi.fn().mockResolvedValue({ ...baseCharacter }) },
      campaigns: campaignFixture(),
      characterStateOrg: {
        findOne: vi.fn().mockResolvedValue(
          level === 0
            ? null
            : {
                characterId: mockCharacterId,
                stateId: "PA",
                level,
                totalInvested: level * STATE_ORG_COST_ACTIONS,
              }
        ),
      },
    });
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
    const response = await POST(buildRequest({ stateId: "PA" }));
    expect(response.status).toBe(403);
  });

  it("returns 400 for an unknown US state code", async () => {
    await setupDb({});

    const { POST } = await import("./route");
    const response = await POST(buildRequest({ stateId: "ZZ" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for an over-long Idempotency-Key header", async () => {
    await setupSuccessOrg();

    const { POST } = await import("./route");
    const response = await POST(buildRequest({ stateId: "PA" }, { "Idempotency-Key": "k".repeat(129) }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/idempotency/i);
  });

  it("returns 400 when the character has no active campaign", async () => {
    // Behaviour change: Campaign Presence is campaign infrastructure funded from
    // the campaign treasury, so a character without one can no longer build it.
    // Asserted explicitly because it removes a capability non-candidates had.
    await setupDb({
      characters: { findOne: vi.fn().mockResolvedValue({ ...baseCharacter }) },
      campaigns: { findOne: vi.fn().mockResolvedValue(null) },
    });

    const { POST } = await import("./route");
    const response = await POST(buildRequest({ stateId: "PA" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/active campaign/i);
  });

  it("returns 400 when the CAMPAIGN has insufficient actions", async () => {
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
      // Presence is campaign-funded: the personal pool is irrelevant, the
      // campaign's is what gates.
      campaigns: campaignFixture({ actions: 1 }),
    });

    const { POST } = await import("./route");
    const response = await POST(buildRequest({ stateId: "PA" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/actions/i);
  });

  it("returns 400 when the CAMPAIGN cannot afford the priced level", async () => {
    await setupDb({
      characters: { findOne: vi.fn().mockResolvedValue({ ...baseCharacter }) },
      campaigns: campaignFixture({ funds: 1 }),
      characterStateOrg: { findOne: vi.fn().mockResolvedValue(null) },
    });

    const { POST } = await import("./route");
    const response = await POST(buildRequest({ stateId: "PA" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/funds/i);
  });

  it("forwards the priced build to the spend primitive and returns its post-image", async () => {
    await setupSuccessOrg(7);
    const { applyStateOrgBuildSpend } = await import("@/lib/elections/stateOrgBuildSpend");
    vi.mocked(applyStateOrgBuildSpend).mockResolvedValue({
      duplicate: false,
      level: 8,
      totalInvested: 24,
    });

    const { POST } = await import("./route");
    const response = await POST(buildRequest({ stateId: "PA" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ level: 8, totalInvested: 24, stateId: "PA" });

    // The curve is what keeps an uncapped ladder from being a flat toll: the
    // route prices level N+1 off the stored level and hands the exact rung to
    // the primitive rather than a constant.
    const call = vi.mocked(applyStateOrgBuildSpend).mock.calls[0]![1];
    expect(call).toMatchObject({
      campaignId: mockCampaignId,
      characterId: mockCharacterId,
      stateId: "PA",
      currentLevel: 7,
      actionCost: STATE_ORG_COST_ACTIONS,
      fundCostLocal: stateOrgLevelCost(7),
    });
    expect(stateOrgLevelCost(7)).toBeGreaterThan(stateOrgLevelCost(0));
    // No client key: the primitive mints one, so none is forwarded.
    expect(call).not.toHaveProperty("idempotencyKey");
    // The turn-based throttle cutoff travels with the priced build.
    expect((call.throttleCutoff as Date).getTime()).toBe(turnStart.getTime());
    expect(call.fingerprint).toContain("PA");
  });

  it("forwards a client Idempotency-Key to the spend primitive", async () => {
    await setupSuccessOrg();
    const { applyStateOrgBuildSpend } = await import("@/lib/elections/stateOrgBuildSpend");

    const { POST } = await import("./route");
    const response = await POST(
      buildRequest({ stateId: "PA" }, { "Idempotency-Key": "client-key-1" })
    );
    expect(response.status).toBe(200);
    expect(vi.mocked(applyStateOrgBuildSpend).mock.calls[0]![1]).toMatchObject({
      idempotencyKey: "client-key-1",
    });
  });

  it("maps a raced campaign debit to 409 without leaking the sentinel", async () => {
    await setupSuccessOrg();
    const { applyStateOrgBuildSpend } = await import("@/lib/elections/stateOrgBuildSpend");
    vi.mocked(applyStateOrgBuildSpend).mockRejectedValue(
      new Error("INSUFFICIENT_RESOURCES:guard-rejected")
    );

    const { POST } = await import("./route");
    const response = await POST(buildRequest({ stateId: "PA" }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/changed/i);
  });

  it("maps a lost throttle/level race to the historical 409", async () => {
    await setupSuccessOrg();
    const { applyStateOrgBuildSpend } = await import("@/lib/elections/stateOrgBuildSpend");
    vi.mocked(applyStateOrgBuildSpend).mockRejectedValue(
      new Error("ORG_RACE_OR_THROTTLE:guard-rejected")
    );

    const { POST } = await import("./route");
    const response = await POST(buildRequest({ stateId: "PA" }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/already built/i);
  });

  it("maps a settled key to 409 instead of charging again", async () => {
    await setupSuccessOrg();
    const { applyStateOrgBuildSpend } = await import("@/lib/elections/stateOrgBuildSpend");
    vi.mocked(applyStateOrgBuildSpend).mockRejectedValue(
      new MoneyFlowTerminalError("client-key-1", "compensated")
    );

    const { POST } = await import("./route");
    const response = await POST(
      buildRequest({ stateId: "PA" }, { "Idempotency-Key": "client-key-1" })
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/new key/i);
  });

  it("maps a reused key for a different build to 409", async () => {
    await setupSuccessOrg();
    const { applyStateOrgBuildSpend } = await import("@/lib/elections/stateOrgBuildSpend");
    vi.mocked(applyStateOrgBuildSpend).mockRejectedValue(
      new MoneyFlowKeyConflictError("client-key-1")
    );

    const { POST } = await import("./route");
    const response = await POST(
      buildRequest({ stateId: "PA" }, { "Idempotency-Key": "client-key-1" })
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/different build/i);
  });

  it("allows building a personal campaign presence in territorial Alaska", async () => {
    await setupDb({
      characters: {
        findOne: vi.fn().mockResolvedValue({ ...baseCharacter }),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      },
      campaigns: campaignFixture(),
      characterStateOrg: {
        findOne: vi.fn().mockResolvedValue({ level: 1, totalInvested: 3 }),
        findOneAndUpdate: vi.fn(),
      },
    });
    const { applyStateOrgBuildSpend } = await import("@/lib/elections/stateOrgBuildSpend");

    const { POST } = await import("./route");
    const response = await POST(buildRequest({ stateId: "AK" }));
    expect(response.status).toBe(200);
    expect(vi.mocked(applyStateOrgBuildSpend).mock.calls[0]![1]).toMatchObject({ stateId: "AK" });
  });
});
