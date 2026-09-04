import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/api/errors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/errors")>("@/lib/api/errors");
  return {
    ...actual,
    handleRouteError: vi.fn((error: unknown) => actual.handleRouteError(error)),
  };
});

import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { ObjectId } from "mongodb";
import {
  CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER,
  campaignStrengthContributionActions,
  campaignStrengthContributionCost,
} from "@/lib/campaigns/campaignStrength";

const mockGetDb = vi.mocked(getDb);
const mockRequireAuth = vi.mocked(requireAuthWithCharacter);
const mockIsForexEnabled = vi.mocked(isForexEnabled);

function makeRequest(campaignId: string): Request {
  return new Request(`http://localhost/api/campaigns/${campaignId}/campaign-strength`, {
    method: "POST",
  });
}

function makeBatchRequest(campaignId: string, clicks: number | "max" | unknown): Request {
  return new Request(`http://localhost/api/campaigns/${campaignId}/campaign-strength`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clicks }),
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Standard presidential-contribution mock world, parameterised by the bits each test varies. */
function batchWorld(opts: {
  charId: ObjectId;
  campaignOid: ObjectId;
  electionOid: ObjectId;
  npi: number;
  actions: number;
  funds: number;
  currentCS: number;
}) {
  const { charId, campaignOid, electionOid, npi, actions, funds, currentCS } = opts;
  return {
    campaigns: {
      findOne: vi.fn().mockResolvedValue({
        _id: campaignOid,
        electionId: electionOid,
        candidateId: new ObjectId(),
        campaignStrength: currentCS,
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    },
    elections: {
      findOne: vi.fn().mockResolvedValue({
        _id: electionOid,
        electionType: "president",
        countryId: "US",
        status: "active",
      }),
    },
    characters: {
      findOne: vi.fn().mockResolvedValue({
        _id: charId,
        name: "Supporter One",
        nationalInfluence: npi,
        actions,
        funds,
        countryId: "US",
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    },
    electionCandidates: {
      findOne: vi.fn().mockResolvedValue({ characterName: "Candidate One", party: "1" }),
    },
    gameState: { findOne: vi.fn().mockResolvedValue({ currentTurn: 42 }) },
    activityLog: { insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }) },
  } as Record<string, any>;
}

describe("POST /api/campaigns/[id]/campaign-strength", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsForexEnabled.mockResolvedValue(false);
  });

  it("returns 400 for invalid campaign ID", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("not-an-objectid"), makeParams("not-an-objectid"));
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockRequireAuth.mockResolvedValueOnce({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as any);
    const { POST } = await import("./route");
    const id = new ObjectId().toString();
    const res = await POST(makeRequest(id), makeParams(id));
    expect(res.status).toBe(401);
  });

  it("returns 404 when campaign not found", async () => {
    const charId = new ObjectId();
    mockRequireAuth.mockResolvedValueOnce({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: charId, nationalInfluence: 50, actions: 100, funds: 1000 },
        hasCharacter: true,
      },
    } as any);
    mockGetDb.mockResolvedValueOnce({
      collection: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(null),
      }),
    } as any);
    const { POST } = await import("./route");
    const id = new ObjectId().toString();
    const res = await POST(makeRequest(id), makeParams(id));
    expect(res.status).toBe(404);
  });

  it("returns 400 when election is not Campaign-Manager-eligible (Phase 5.5 D4 — non-US deferred)", async () => {
    // Phase 5.5 widened the eligibility matrix: US president + senate /
    // governor / house / stateSenate are now eligible. Non-US races stay
    // explicitly rejected per D4. Use UK commons to exercise the gate.
    const charId = new ObjectId();
    const campaignOid = new ObjectId();
    const electionOid = new ObjectId();
    const mockCampaign = { _id: campaignOid, electionId: electionOid, campaignStrength: 0 };
    const mockElection = {
      _id: electionOid,
      electionType: "commons",
      countryId: "UK",
      status: "active",
    };

    mockRequireAuth.mockResolvedValueOnce({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: charId, nationalInfluence: 50, actions: 100, funds: 1000 },
        hasCharacter: true,
      },
    } as any);

    const collections: Record<string, any> = {
      campaigns: {
        findOne: vi
          .fn()
          .mockImplementation(({ _id }) => (_id.equals(campaignOid) ? mockCampaign : null)),
      },
      elections: { findOne: vi.fn().mockResolvedValue(mockElection) },
      // P1d-era guard: assertCampaignActiveForManagement verifies the candidate
      // row is still active before the check under test here.
      electionCandidates: {
        findOne: vi
          .fn()
          .mockResolvedValue({ characterName: "Candidate One", party: "1", status: "active" }),
      },
    };
    mockGetDb.mockResolvedValueOnce({ collection: vi.fn((name) => collections[name]) } as any);

    const { POST } = await import("./route");
    const res = await POST(makeRequest(campaignOid.toString()), makeParams(campaignOid.toString()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not available/i);
  });

  it("returns 400 when election is completed", async () => {
    const charId = new ObjectId();
    const campaignOid = new ObjectId();
    const electionOid = new ObjectId();
    const mockCampaign = { _id: campaignOid, electionId: electionOid, campaignStrength: 0 };
    const mockElection = {
      _id: electionOid,
      electionType: "president",
      countryId: "US",
      status: "completed",
    };

    mockRequireAuth.mockResolvedValueOnce({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: charId, nationalInfluence: 50, actions: 100, funds: 1000 },
        hasCharacter: true,
      },
    } as any);

    const collections: Record<string, any> = {
      campaigns: { findOne: vi.fn().mockResolvedValue(mockCampaign) },
      elections: { findOne: vi.fn().mockResolvedValue(mockElection) },
      // P1d-era guard: assertCampaignActiveForManagement verifies the candidate
      // row is still active before the check under test here.
      electionCandidates: {
        findOne: vi
          .fn()
          .mockResolvedValue({ characterName: "Candidate One", party: "1", status: "active" }),
      },
      characters: {
        findOne: vi.fn().mockResolvedValue({
          _id: charId,
          nationalInfluence: 50,
          actions: 5,
          funds: 1000,
          countryId: "US",
        }),
      },
    };
    mockGetDb.mockResolvedValueOnce({ collection: vi.fn((name) => collections[name]) } as any);

    const { POST } = await import("./route");
    const res = await POST(makeRequest(campaignOid.toString()), makeParams(campaignOid.toString()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/ended/i);
  });

  it("returns 400 when character has insufficient actions", async () => {
    const charId = new ObjectId();
    const campaignOid = new ObjectId();
    const electionOid = new ObjectId();
    const mockCampaign = { _id: campaignOid, electionId: electionOid, campaignStrength: 0 };
    const mockElection = {
      _id: electionOid,
      electionType: "president",
      countryId: "US",
      status: "active",
    };

    mockRequireAuth.mockResolvedValueOnce({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: charId, nationalInfluence: 3000, actions: 5, funds: 1000 },
        hasCharacter: true,
      },
    } as any);

    const collections: Record<string, any> = {
      campaigns: { findOne: vi.fn().mockResolvedValue(mockCampaign) },
      elections: { findOne: vi.fn().mockResolvedValue(mockElection) },
      // P1d-era guard: assertCampaignActiveForManagement verifies the candidate
      // row is still active before the check under test here.
      electionCandidates: {
        findOne: vi
          .fn()
          .mockResolvedValue({ characterName: "Candidate One", party: "1", status: "active" }),
      },
      characters: {
        findOne: vi.fn().mockResolvedValue({
          _id: charId,
          // 3,000 NPI buys 2,250 CS, which costs 8 actions under the
          // quantity-scaled price — more than the 5 this character holds.
          nationalInfluence: 3000,
          actions: 5,
          funds: 1000,
          countryId: "US",
        }),
      },
    };
    mockGetDb.mockResolvedValueOnce({ collection: vi.fn((name) => collections[name]) } as any);

    const { POST } = await import("./route");
    const res = await POST(makeRequest(campaignOid.toString()), makeParams(campaignOid.toString()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/actions/i);
  });

  it("returns 200 and correct cost on success", async () => {
    const charId = new ObjectId();
    const campaignOid = new ObjectId();
    const electionOid = new ObjectId();
    const candidateId = new ObjectId();
    const npi = 100;
    const currentCS = 0;
    const strengthAdded = npi * CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER;
    const expectedCost = campaignStrengthContributionCost(currentCS, strengthAdded);

    const mockCampaign = {
      _id: campaignOid,
      electionId: electionOid,
      candidateId,
      campaignStrength: currentCS,
    };
    const mockElection = {
      _id: electionOid,
      electionType: "president",
      countryId: "US",
      status: "active",
    };

    mockRequireAuth.mockResolvedValueOnce({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: charId, nationalInfluence: npi, actions: 50, funds: 5_000_000 },
        hasCharacter: true,
      },
    } as any);

    const charUpdateResult = { matchedCount: 1 };
    const campaignUpdateResult = {};
    const activityInsertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const collections: Record<string, any> = {
      campaigns: {
        findOne: vi.fn().mockResolvedValue(mockCampaign),
        updateOne: vi.fn().mockResolvedValue(campaignUpdateResult),
      },
      elections: { findOne: vi.fn().mockResolvedValue(mockElection) },
      electionCandidates: {
        findOne: vi.fn().mockResolvedValue({
          characterName: "Candidate One",
          party: "1",
        }),
      },
      characters: {
        findOne: vi.fn().mockResolvedValue({
          _id: charId,
          name: "Supporter One",
          nationalInfluence: npi,
          actions: 50,
          funds: 5_000_000,
          countryId: "US",
        }),
        updateOne: vi.fn().mockResolvedValue(charUpdateResult),
      },
      gameState: { findOne: vi.fn().mockResolvedValue({ currentTurn: 42 }) },
      activityLog: { insertOne: activityInsertOne },
    };
    mockGetDb.mockResolvedValueOnce({ collection: vi.fn((name) => collections[name]) } as any);

    const { POST } = await import("./route");
    const res = await POST(makeRequest(campaignOid.toString()), makeParams(campaignOid.toString()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.strengthAdded).toBeCloseTo(strengthAdded);
    expect(body.costFunds).toBeCloseTo(expectedCost);
    expect(body.costActions).toBe(campaignStrengthContributionActions(strengthAdded));
    expect(body.currencyCode).toBe("USD");
    expect(body.campaignStrength).toBeCloseTo(currentCS + strengthAdded);
    expect(activityInsertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "game_action",
        actionType: "campaign_strength",
        actionCost: campaignStrengthContributionActions(strengthAdded),
        turn: 42,
        targetId: campaignOid,
        targetName: "Candidate One",
        targetType: "campaign",
        details: expect.objectContaining({
          campaignId: campaignOid.toString(),
          electionId: electionOid.toString(),
          strengthAdded,
          campaignStrengthBefore: currentCS,
          campaignStrengthAfter: currentCS + strengthAdded,
          costFunds: expectedCost,
          currencyCode: "USD",
        }),
      })
    );
  });

  // Regression test for in-game bug #0553 (Pete Wilson). The character's
  // funds mirror had drifted negative (-$2.4M) while currencyBalances.campaign
  // held the real local balance ($208K). The old server filter
  // `funds: { $gte: costFunds }` rejected the update because the stale mirror
  // looked broke, blocking the action despite ample real balance.
  it("allows contribution when funds mirror is stale-low but stored balance is sufficient", async () => {
    mockIsForexEnabled.mockResolvedValueOnce(true);

    const charId = new ObjectId();
    const campaignOid = new ObjectId();
    const electionOid = new ObjectId();
    const npi = 100;
    const expectedCost = campaignStrengthContributionCost(
      0,
      npi * CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER
    );

    mockRequireAuth.mockResolvedValueOnce({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: charId, nationalInfluence: npi, actions: 50, funds: -2_400_000 },
        hasCharacter: true,
      },
    } as any);

    // Records the updateOne filter so we can assert it does NOT gate on
    // `funds: { $gte: ... }`. Mock returns matchedCount: 1, so an unfixed
    // route also makes the test pass against the mock — but the filter
    // inspection below catches the regression.
    const charUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const collections: Record<string, any> = {
      campaigns: {
        findOne: vi.fn().mockResolvedValue({
          _id: campaignOid,
          electionId: electionOid,
          candidateId: new ObjectId(),
          campaignStrength: 0,
        }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      },
      elections: {
        findOne: vi.fn().mockResolvedValue({
          _id: electionOid,
          electionType: "president",
          status: "active",
          countryId: "US",
        }),
      },
      characters: {
        findOne: vi.fn().mockResolvedValue({
          _id: charId,
          name: "Supporter One",
          nationalInfluence: npi,
          actions: 50,
          funds: -2_400_000, // stale anchor mirror, drift bug
          countryId: "US",
          currencyBalances: { campaign: 208_000, personal: { USD: 0 } }, // real local USD
        }),
        updateOne: charUpdateOne,
      },
      electionCandidates: {
        findOne: vi.fn().mockResolvedValue({ characterName: "Candidate One", party: "1" }),
      },
      gameState: { findOne: vi.fn().mockResolvedValue({ currentTurn: 42 }) },
      activityLog: { insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }) },
      exchangeRates: {
        findOne: vi.fn().mockResolvedValue({ rate: 1 }),
      },
    };
    mockGetDb.mockResolvedValueOnce({ collection: vi.fn((name) => collections[name]) } as any);

    const { POST } = await import("./route");
    const res = await POST(makeRequest(campaignOid.toString()), makeParams(campaignOid.toString()));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.costFunds).toBeCloseTo(expectedCost);
    expect(body.currencyCode).toBe("USD");

    // The filter must guard on the stored local balance, not on the stale `funds` mirror.
    const filterUsed = charUpdateOne.mock.calls[0][0];
    expect(filterUsed).not.toHaveProperty("funds");
    expect(filterUsed).toHaveProperty(["currencyBalances.campaign"]);
  });

  it("debits at the frozen base rate (US ×1.0), ignoring the live forex rate", async () => {
    // Campaign funds are decoupled from live forex: the strength-contribution
    // cost converts anchor→local at the frozen base INITIAL_RATES scale (US=1.0),
    // NOT the live exchangeRates rate (seeded to 2 below to prove it is ignored —
    // pre-fix this debit was cost×2). It still writes ONLY currencyBalances.campaign
    // (no `funds` anchor mirror).
    mockIsForexEnabled.mockResolvedValueOnce(true);

    const charId = new ObjectId();
    const campaignOid = new ObjectId();
    const electionOid = new ObjectId();
    const npi = 100;
    const currentCS = 0;
    const expectedAnchorCost = campaignStrengthContributionCost(
      0,
      npi * CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER
    );
    const liveRate = 2; // seeded into exchangeRates but MUST be ignored
    const expectedLocalCost = expectedAnchorCost * 1.0; // US frozen INITIAL_RATES base

    mockRequireAuth.mockResolvedValueOnce({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: charId, nationalInfluence: npi, actions: 50, funds: 5_000_000 },
        hasCharacter: true,
      },
    } as any);

    const collections: Record<string, any> = {
      campaigns: {
        findOne: vi.fn().mockResolvedValue({
          _id: campaignOid,
          electionId: electionOid,
          candidateId: new ObjectId(),
          campaignStrength: currentCS,
        }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      },
      elections: {
        findOne: vi.fn().mockResolvedValue({
          _id: electionOid,
          electionType: "president",
          countryId: "US",
          status: "active",
        }),
      },
      characters: {
        findOne: vi.fn().mockResolvedValue({
          _id: charId,
          name: "Supporter One",
          nationalInfluence: npi,
          actions: 50,
          funds: 5_000_000,
          countryId: "US",
          currencyBalances: { campaign: 5_000_000, personal: { USD: 0 } },
        }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      },
      electionCandidates: {
        findOne: vi.fn().mockResolvedValue({ characterName: "Candidate One", party: "1" }),
      },
      gameState: { findOne: vi.fn().mockResolvedValue({ currentTurn: 42 }) },
      activityLog: { insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }) },
      exchangeRates: {
        findOne: vi.fn().mockResolvedValue({ rate: liveRate }),
      },
    };
    mockGetDb.mockResolvedValueOnce({ collection: vi.fn((name) => collections[name]) } as any);

    const { POST } = await import("./route");
    const res = await POST(makeRequest(campaignOid.toString()), makeParams(campaignOid.toString()));

    expect(res.status).toBe(200);
    const charUpdate = collections.characters.updateOne.mock.calls[0];
    expect(charUpdate[1].$inc).toEqual({
      actions: -campaignStrengthContributionActions(
        npi * CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER
      ),
      "currencyBalances.campaign": -expectedLocalCost,
    });
    expect(charUpdate[1].$inc).not.toHaveProperty("funds");
  });
});

/**
 * Batched Support (x1 / x5 / Max on the presidential race page). The contract
 * the UI sells the player is that a batch costs what the same number of single
 * clicks costs, so these assert against the per-click primitives rather than
 * against hard-coded numbers.
 */
describe("POST /api/campaigns/[id]/campaign-strength - batched clicks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsForexEnabled.mockResolvedValue(false);
  });

  it("charges a clicks:5 batch as five single contributions", async () => {
    const charId = new ObjectId();
    const campaignOid = new ObjectId();
    const electionOid = new ObjectId();
    const npi = 100;
    const perClick = npi * CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER;
    const currentCS = 1_000;

    mockRequireAuth.mockResolvedValueOnce({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: charId, nationalInfluence: npi, actions: 50, funds: 5_000_000 },
        hasCharacter: true,
      },
    } as any);
    const collections = batchWorld({
      charId,
      campaignOid,
      electionOid,
      npi,
      actions: 50,
      funds: 5_000_000,
      currentCS,
    });
    mockGetDb.mockResolvedValueOnce({ collection: vi.fn((name) => collections[name]) } as any);

    const { POST } = await import("./route");
    const res = await POST(
      makeBatchRequest(campaignOid.toString(), 5),
      makeParams(campaignOid.toString())
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clicks).toBe(5);
    expect(body.strengthAdded).toBeCloseTo(perClick * 5);
    // Funds: the exact integral across the whole span, which equals the sum of
    // the five separate charges.
    expect(body.costFunds).toBeCloseTo(campaignStrengthContributionCost(currentCS, perClick * 5));
    // Actions: five clicks' worth, NOT ceil(5 * perClick / POINTS_PER_ACTION),
    // which would be a 2.5x discount at this influence level.
    expect(body.costActions).toBe(campaignStrengthContributionActions(perClick) * 5);
    expect(body.costActions).toBeGreaterThan(campaignStrengthContributionActions(perClick * 5));
    expect(collections.campaigns.updateOne.mock.calls[0][1].$inc.campaignStrength).toBeCloseTo(
      perClick * 5
    );
  });

  it("resolves clicks:max server-side against the actions the player really has", async () => {
    const charId = new ObjectId();
    const campaignOid = new ObjectId();
    const electionOid = new ObjectId();
    const npi = 100; // perClick 75 -> exactly 1 action each
    const perClick = npi * CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER;

    mockRequireAuth.mockResolvedValueOnce({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: charId, nationalInfluence: npi, actions: 7, funds: 500_000_000 },
        hasCharacter: true,
      },
    } as any);
    const collections = batchWorld({
      charId,
      campaignOid,
      electionOid,
      npi,
      actions: 7,
      funds: 500_000_000,
      currentCS: 0,
    });
    mockGetDb.mockResolvedValueOnce({ collection: vi.fn((name) => collections[name]) } as any);

    const { POST } = await import("./route");
    const res = await POST(
      makeBatchRequest(campaignOid.toString(), "max"),
      makeParams(campaignOid.toString())
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clicks).toBe(7);
    expect(body.costActions).toBe(7);
    expect(body.strengthAdded).toBeCloseTo(perClick * 7);
  });

  it("rejects clicks:max with a resource error rather than a zero-value contribution", async () => {
    const charId = new ObjectId();
    const campaignOid = new ObjectId();
    const electionOid = new ObjectId();
    const npi = 100;

    mockRequireAuth.mockResolvedValueOnce({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: charId, nationalInfluence: npi, actions: 0, funds: 5_000_000 },
        hasCharacter: true,
      },
    } as any);
    const collections = batchWorld({
      charId,
      campaignOid,
      electionOid,
      npi,
      actions: 0,
      funds: 5_000_000,
      currentCS: 0,
    });
    mockGetDb.mockResolvedValueOnce({ collection: vi.fn((name) => collections[name]) } as any);

    const { POST } = await import("./route");
    const res = await POST(
      makeBatchRequest(campaignOid.toString(), "max"),
      makeParams(campaignOid.toString())
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/insufficient actions/i);
    expect(collections.campaigns.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a malformed clicks value before touching the database", async () => {
    const campaignOid = new ObjectId();
    mockRequireAuth.mockResolvedValueOnce({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: new ObjectId(), nationalInfluence: 100, actions: 50, funds: 5_000_000 },
        hasCharacter: true,
      },
    } as any);

    const { POST } = await import("./route");
    const res = await POST(
      makeBatchRequest(campaignOid.toString(), 0),
      makeParams(campaignOid.toString())
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/clicks/i);
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("still treats an empty body as a single click", async () => {
    const charId = new ObjectId();
    const campaignOid = new ObjectId();
    const electionOid = new ObjectId();
    const npi = 100;
    const perClick = npi * CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER;

    mockRequireAuth.mockResolvedValueOnce({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: charId, nationalInfluence: npi, actions: 50, funds: 5_000_000 },
        hasCharacter: true,
      },
    } as any);
    const collections = batchWorld({
      charId,
      campaignOid,
      electionOid,
      npi,
      actions: 50,
      funds: 5_000_000,
      currentCS: 0,
    });
    mockGetDb.mockResolvedValueOnce({ collection: vi.fn((name) => collections[name]) } as any);

    const { POST } = await import("./route");
    const res = await POST(makeRequest(campaignOid.toString()), makeParams(campaignOid.toString()));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clicks).toBe(1);
    expect(body.strengthAdded).toBeCloseTo(perClick);
  });
});
