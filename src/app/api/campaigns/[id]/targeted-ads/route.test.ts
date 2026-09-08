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
  turns: 3,
  quote: { turn: 10, cost: 6000, revision: 0 },
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

  it("returns a private quote without spending resources", async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/campaigns/${campaignId}/targeted-ads`),
      params
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const quote = await response.json();
    expect(quote.targets[0]).toMatchObject({ cost: 2000, available: true });
    expect(quote.targets[0].afterBonus).toBeGreaterThan(0.09);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("precharges every turn and writes one candidate-owned flight", async () => {
    const response = await POST(request(purchase), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cost: 6000, actions: 15, scheduledThrough: 12 });
    expect(db.collection("characters").updateOne.mock.calls[0][0]).toMatchObject({
      actions: { $gte: 15 },
      funds: { $gte: 6000 },
    });
    expect(db.collection("characters").updateOne.mock.calls[0][1]).toEqual({
      $inc: { actions: -15, funds: -6000 },
    });
    expect(
      db.collection("electionCandidates").updateOne.mock.calls[0][1].$set.targetedAds[0]
    ).toMatchObject({
      stateId: "CA",
      dimension: "race",
      bucket: "white",
      exposure: 1,
      lastPurchaseTurn: 10,
      throughTurn: 12,
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
    expect((await response.json()).targets[0].afterBonus).toBeGreaterThan(0.09);
  });

  it("blocks overlapping buys from any manager without charging", async () => {
    db.collection("electionCandidates").findOne.mockResolvedValue({
      ...candidate,
      targetedAds: [{ ...purchase, exposure: 1, lastPurchaseTurn: 10, throughTurn: 12 }],
    });
    expect((await POST(request(purchase), params)).status).toBe(409);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("refunds resources if the candidate revision changed after the quote", async () => {
    db.collection("electionCandidates").updateOne.mockResolvedValue({ modifiedCount: 0 });
    expect((await POST(request(purchase), params)).status).toBe(409);
    expect(db.collection("characters").updateOne.mock.calls[1][1]).toEqual({
      $inc: { actions: 15, funds: 6000 },
    });
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

  it.each([0, -1, 1.5, 13, "3", null])("rejects malformed flight length %s", async (turns) => {
    expect((await POST(request({ ...purchase, turns }), params)).status).toBe(400);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("rejects foreign regions, wrong identities, and flights beyond election day", async () => {
    expect((await POST(request({ ...purchase, stateId: "TX" }), params)).status).toBe(403);
    expect((await POST(request({ ...purchase, bucket: "unknown" }), params)).status).toBe(400);
    db.collection("elections").findOne.mockResolvedValue({ ...election, endTurn: 11 });
    expect((await POST(request(purchase), params)).status).toBe(400);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("does not sell ads to a presidential engine without demographic allocation", async () => {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) throw new Error("fixture requires authentication");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ...auth,
      user: { ...auth.user, character: { ...character, countryId: "NG" } },
    });
    db.collection("elections").findOne.mockResolvedValue({
      ...election,
      countryId: "NG",
      state: "NG",
      electionType: "president",
    });
    const result = await POST(request(purchase), {
      params: Promise.resolve({ id: campaignId.toString() }),
    });
    expect(result.status).toBe(400);
    expect((await result.json()).error).toContain("Targeted ads are unavailable");
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("keeps old races closed to new ad purchases", async () => {
    db.collection("elections").findOne.mockResolvedValue({
      ...election,
      campaignRulesVersion: undefined,
    });
    expect((await POST(request(purchase), params)).status).toBe(400);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

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
