import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { makeCandidate, makeCharacter, makeElection } from "@/lib/test-utils/factories";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { getGameTime } from "@/lib/time/gameTime";
import { isCampaignNomineeUser } from "@/lib/campaigns/access";
import { loadCampaignAudience } from "@/lib/campaignTargeting/audience";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { GET, POST } from "./route";
import * as awaitRateLimit from "@/lib/api/rateLimit";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/campaigns/access", () => ({
  isCampaignManagerUser: vi.fn(),
  isCampaignNomineeUser: vi.fn(),
}));
vi.mock("@/lib/campaignTargeting/audience", () => ({ loadCampaignAudience: vi.fn() }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: async (_transaction: unknown, fallback: () => Promise<void>) =>
    fallback(),
}));

const campaignId = new ObjectId();
const request = (body: unknown) =>
  new NextRequest(`http://localhost/api/campaigns/${campaignId}/targeted-ads`, {
    method: "POST",
    body: JSON.stringify(body),
  });
const purchase = {
  stateId: "CA",
  dimension: "race",
  bucket: "white",
  turns: 3,
  quote: { turn: 10, cost: 6000, revision: 0 },
};

describe("standing targeted ad actions", () => {
  let db: ReturnType<typeof createMockDb>;
  const character = makeCharacter({
    actions: 100,
    funds: 100_000,
    homeState: "CA",
    policies: { economic: 3, social: 3 },
  });
  const election = makeElection({ campaignRulesVersion: 1, startTurn: 1, endTurn: 30 });
  const candidate = makeCandidate({ electionId: election._id, characterId: character._id });

  beforeEach(() => {
    vi.resetAllMocks();
    const { checkRateLimit } = awaitRateLimit;
    vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as never);
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: character.userId.toString(),
        username: "tester",
        email: "tester@example.test",
        role: "user",
        isAdmin: false,
        isBanned: false,
        hasCharacter: true,
        character,
      },
    });
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 10,
      startingYear: 1953,
      effectiveNow: new Date(0),
      lastTurnProcessed: new Date(0),
      isActive: true,
      pausedAt: null,
    });
    vi.mocked(isCampaignNomineeUser).mockResolvedValue(true);
    vi.mocked(isForexEnabled).mockResolvedValue(false);
    db.collection("campaigns").findOne.mockResolvedValue({
      _id: campaignId,
      electionId: election._id,
      candidateId: candidate.characterId,
      status: "active",
    });
    db.collection("elections").findOne.mockResolvedValue(election);
    db.collection("electionCandidates").findOne.mockResolvedValue(candidate);
    db.collection("characters").findOne.mockResolvedValue(character);
    db.collection("states").findOne.mockImplementation(async (filter: { _id: string }) =>
      filter._id === "CA" ? { _id: "CA", countryId: "US" } : null
    );
    db.collection("states").find.mockReturnValue({
      toArray: async () => [{ _id: "CA", name: "California" }],
    });
    const cells = [
      {
        id: "cell",
        economicLean: 3,
        socialLean: 3,
        share: 1,
        turnout: 50,
        buckets: { race: "white" },
        identities: { race: { economicLean: 3, socialLean: 3 } },
      },
    ];
    // Only the audience loader is isolated; the actual pricing, pacing, auth,
    // currency debit and candidate write execute through the HTTP handler.
    vi.mocked(loadCampaignAudience).mockResolvedValue({
      cells,
      context: {
        countryId: "US",
        stateId: "CA",
        campaignRulesVersion: 1,
        currentTurn: 10,
        statePopulation: 1_000_000,
        stateEconomicLean: undefined,
        stateSocialLean: undefined,
        votingSystem: undefined,
        demographics: {
          _id: "CA",
          countryId: "US",
          categoryWeights: {},
          groups: {},
          lastUpdated: new Date(0),
        },
        categories: [],
        demographicDefaults: null,
        enriched: [],
        year: null,
        startingYear: null,
        preset: undefined,
      },
      build: () => null,
    });
  });

  it("quotes and buys without any candidacy, using one atomic personal write", async () => {
    db.collection("campaigns").findOne.mockResolvedValue(null);
    db.collection("elections").findOne.mockResolvedValue(null);
    db.collection("electionCandidates").findOne.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/targeted-ads"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).maxFlightTurns).toBe(12);
    const bought = await POST(request(purchase));
    expect(bought.status).toBe(200);
    expect(db.collection("characters").updateOne).toHaveBeenCalledOnce();
    expect(db.collection("characters").updateOne.mock.calls[0][1]).toMatchObject({
      $inc: { actions: -15, funds: -6000, targetedAdsRevision: 1 },
      $set: { targetedAds: [expect.objectContaining({ stateId: "CA", throughTurn: 12 })] },
    });
    expect(db.collection("elections").findOne).not.toHaveBeenCalled();
    expect(db.collection("campaigns").findOne).not.toHaveBeenCalled();
    expect(db.collection("electionCandidates").findOne).not.toHaveBeenCalled();
  });

  it("prices and debits ads using the world's stored campaign currency basis", async () => {
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    db.collection("exchangeRates").find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", baseRate: 2, rate: 9 }],
    });
    const response = await GET(new NextRequest("http://localhost/api/targeted-ads"));
    expect((await response.json()).targets[0].cost).toBe(4000);
    const bought = await POST(request({ ...purchase, quote: { ...purchase.quote, cost: 12000 } }));
    expect(bought.status).toBe(200);
    expect(db.collection("characters").updateOne.mock.calls[0][1]).toMatchObject({
      $inc: { actions: -15, "currencyBalances.campaign": -12000, targetedAdsRevision: 1 },
    });
  });

  it("rejects foreign regions, stale prices and overlapping flights without spending", async () => {
    expect((await POST(request({ ...purchase, stateId: "foreign" }))).status).toBe(400);
    expect(
      (await POST(request({ ...purchase, quote: { ...purchase.quote, cost: 1 } }))).status
    ).toBe(409);
    db.collection("characters").findOne.mockResolvedValue({
      ...character,
      targetedAds: [{ ...purchase, lastPurchaseTurn: 10, throughTurn: 12, exposure: 1 }],
    });
    expect((await POST(request(purchase))).status).toBe(409);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("requires authentication and limits previews before audience work", async () => {
    vi.mocked(awaitRateLimit.checkRateLimit).mockReturnValue({
      ok: false,
      retryAfter: 30,
    } as never);
    vi.mocked(awaitRateLimit.rateLimitResponse).mockReturnValue(
      NextResponse.json({}, { status: 429 })
    );
    expect((await GET(new NextRequest("http://localhost/api/targeted-ads"))).status).toBe(429);
    expect(loadCampaignAudience).not.toHaveBeenCalled();
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: NextResponse.json({}, { status: 401 }),
    });
    expect((await POST(request(purchase))).status).toBe(401);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("rejects malformed flights before a write", async () => {
    for (const turns of [0, 13, 1.5, "2"])
      expect((await POST(request({ ...purchase, turns }))).status).toBe(400);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });
});
