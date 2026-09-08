import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { makeCandidate, makeCharacter, makeElection } from "@/lib/test-utils/factories";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { getGameTime } from "@/lib/time/gameTime";
import { isCampaignManagerUser, isCampaignNomineeUser } from "@/lib/campaigns/access";
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
const params = { params: Promise.resolve({ id: campaignId.toString() }) };
const request = (body: unknown) =>
  new NextRequest(`http://localhost/api/campaigns/${campaignId}/targeted-ads`, {
    method: "POST",
    body: JSON.stringify(body),
  });
const purchase = {
  stateId: "CA",
  dimension: "race",
  bucket: "white",
  count: 3,
  quote: { turn: 10, cost: 300, revision: 0 },
};

describe("targeted ad route and command integration", () => {
  let db: ReturnType<typeof createMockDb>;
  const character = makeCharacter({
    actions: 100,
    funds: 100_000,
    policies: { economic: 3, social: 3 },
  });
  const election = makeElection({ campaignRulesVersion: 1, startTurn: 1, endTurn: 30 });
  const candidate = makeCandidate({ electionId: election._id, characterId: character._id });

  it("rate-limits previews before loading or calculating an audience", async () => {
    vi.mocked(awaitRateLimit.checkRateLimit).mockReturnValue({
      ok: false,
      retryAfter: 30,
    } as never);
    vi.mocked(awaitRateLimit.rateLimitResponse).mockReturnValue(
      NextResponse.json({}, { status: 429 })
    );
    const result = await GET(
      new NextRequest(`http://localhost/api/campaigns/${campaignId}/targeted-ads`),
      params
    );
    expect(result.status).toBe(429);
    expect(getDb).not.toHaveBeenCalled();
    expect(loadCampaignAudience).not.toHaveBeenCalled();
  });

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

  it("recount a private quote without spending resources", async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/campaigns/${campaignId}/targeted-ads`),
      params
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const quote = await response.json();
    expect(quote.targets[0]).toMatchObject({ cost: 100, available: true });
    expect(quote.targets[0].afterBonus).toBeGreaterThan(0.009);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("charges a selected action batch atomically with an immediate character bonus", async () => {
    const response = await POST(request(purchase), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cost: 300, actions: 3, bonus: 0.03 });
    expect(db.collection("characters").updateOne.mock.calls[0][0]).toMatchObject({
      actions: { $gte: 3 },
      funds: { $gte: 300 },
    });
    expect(db.collection("characters").updateOne.mock.calls[0][1].$inc).toEqual({
      actions: -3,
      funds: -300,
      targetedAdsRevision: 1,
    });
    expect(
      db.collection("characters").updateOne.mock.calls[0][1].$set.targetedAds[0]
    ).toMatchObject({
      stateId: "CA",
      dimension: "race",
      bucket: "white",

      lastPurchaseTurn: 10,
      bonus: 0.03,
    });
  });

  it("uses candidate ideology even when a differently aligned manager pays", async () => {
    vi.mocked(isCampaignNomineeUser).mockResolvedValue(false);
    vi.mocked(isCampaignManagerUser).mockReturnValue(true);
    const manager = makeCharacter({ policies: { economic: -5, social: -5 } });
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: manager.userId.toString(),
        username: "manager",
        email: "manager@example.test",
        role: "user",
        isAdmin: false,
        isBanned: false,
        hasCharacter: true,
        character: manager,
      },
    });
    const response = await GET(
      new NextRequest(`http://localhost/api/campaigns/${campaignId}/targeted-ads`),
      params
    );
    expect((await response.json()).targets[0].afterBonus).toBeGreaterThan(0.009);
  });

  it("blocks capped targets from any manager without charging", async () => {
    db.collection("characters").findOne.mockResolvedValue({
      ...character,
      targetedAds: [{ ...purchase, lastPurchaseTurn: 10, bonus: 0.25 }],
    });
    expect((await POST(request(purchase), params)).status).toBe(400);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("atomically rejects a revision conflict without a separate debit", async () => {
    db.collection("characters").updateOne.mockResolvedValue({ modifiedCount: 0 });
    expect((await POST(request(purchase), params)).status).toBe(409);
    expect(db.collection("characters").updateOne).toHaveBeenCalledOnce();
    expect(db.collection("characters").updateOne.mock.calls[0][0]).toMatchObject({
      targetedAdsRevision: { $exists: false },
    });
    expect(db.collection("electionCandidates").updateOne).not.toHaveBeenCalled();
  });

  it("refunds a manager when the owner's revision changes after their debit", async () => {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) throw new Error("Expected fixture user");
    const manager = makeCharacter();
    vi.mocked(isCampaignManagerUser).mockReturnValue(true);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ...auth,
      user: { ...auth.user, userId: manager.userId.toString(), character: manager },
    });
    db.collection("characters")
      .updateOne.mockResolvedValueOnce({ modifiedCount: 1 })
      .mockResolvedValueOnce({ modifiedCount: 0 })
      .mockResolvedValueOnce({ modifiedCount: 1 });
    expect((await POST(request(purchase), params)).status).toBe(409);
    const calls = db.collection("characters").updateOne.mock.calls;
    expect(calls[0][0]._id).toEqual(manager._id);
    expect(calls[1][0]._id).toEqual(character._id);
    expect(calls[2][0]._id).toEqual(manager._id);
    expect(calls[2][1]).toEqual({ $inc: { actions: 3, funds: 300 } });
  });

  it("rejects an expired quote or a changed price before spending", async () => {
    expect(
      (await POST(request({ ...purchase, quote: { ...purchase.quote, turn: 9 } }), params)).status
    ).toBe(409);
    expect(
      (await POST(request({ ...purchase, quote: { ...purchase.quote, cost: 1 } }), params)).status
    ).toBe(409);
    expect(
      (await POST(request({ ...purchase, quote: { ...purchase.quote, revision: 1 } }), params))
        .status
    ).toBe(409);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without spending", async () => {
    const malformed = new NextRequest(`http://localhost/api/campaigns/${campaignId}/targeted-ads`, {
      method: "POST",
      body: "{",
    });
    expect((await POST(malformed, params)).status).toBe(400);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("does not write an ad when personal resources are insufficient", async () => {
    db.collection("characters").updateOne.mockResolvedValue({ modifiedCount: 0 });
    expect((await POST(request(purchase), params)).status).toBe(409);
    expect(db.collection("electionCandidates").updateOne).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 51, "3", null])("rejects malformed action count %s", async (count) => {
    expect((await POST(request({ ...purchase, count }), params)).status).toBe(400);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("rejects foreign regions and unknown identities before spending", async () => {
    expect((await POST(request({ ...purchase, stateId: "outside" }), params)).status).toBe(403);
    expect((await POST(request({ ...purchase, bucket: "unknown" }), params)).status).toBe(400);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("lets standing exposure outlast this campaign", async () => {
    db.collection("elections").findOne.mockResolvedValue({ ...election, endTurn: 11 });
    expect((await POST(request(purchase), params)).status).toBe(200);
  });

  it.each(["president", "house", "senate", "governor"])(
    "allows purchases for an existing %s race",
    async (electionType) => {
      db.collection("elections").findOne.mockResolvedValue({
        ...election,
        electionType,
        campaignRulesVersion: undefined,
      });
      expect((await POST(request(purchase), params)).status).toBe(200);
      expect(db.collection("elections").updateOne).not.toHaveBeenCalled();
    }
  );

  it("rejects unauthorized viewers before reading the electorate", async () => {
    vi.mocked(isCampaignNomineeUser).mockResolvedValue(false);
    expect((await POST(request(purchase), params)).status).toBe(403);
    expect(loadCampaignAudience).not.toHaveBeenCalled();
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await POST(request(purchase), params)).status).toBe(401);
  });
});
