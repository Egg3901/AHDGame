import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi.fn(async (_runInTransaction, runWithoutTransaction) =>
    runWithoutTransaction()
  ),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/npps/123/direct-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/npps/[id]/direct-action", () => {
  let db: MockDb;
  let characterId: ObjectId;
  let nppId: ObjectId;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    characterId = new ObjectId();
    nppId = new ObjectId();

    db.collection("npps");
    db.collection("characters");
    db.collection("nppRelationships");
    db.collection("gameState");
    db.collection("electionCandidates");
    db.collection("nppEndorsements");
    db.collection("capitalActionLogs");

    db.collectionMocks["npps"]!.findOne.mockResolvedValue({
      _id: nppId,
      name: "Target NPP",
      countryId: "US",
      homeState: "US_CA",
      party: "1",
      currentOffice: { type: "house", state: "US_CA", seatsHeld: 1 },
      personality: { loyalty: 60, ambition: 50, stubbornness: 40 },
      policies: { economic: 0, social: 0 },
      politicalInfluence: 10,
      favorability: 50,
      generatedAt: new Date(),
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: characterId,
      actions: 30,
      funds: 50000,
      policies: { economic: 0, social: 0 },
    });
    db.collectionMocks["characters"]!.updateOne.mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks["characters"]!.findOneAndUpdate.mockResolvedValue({
      _id: characterId,
      actions: 25,
      funds: 40000,
    });
    db.collectionMocks["nppRelationships"]!.findOne.mockResolvedValue({
      _id: `${characterId.toString()}_${nppId.toString()}`,
      relationshipScore: 25,
    });
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 10,
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        character: {
          _id: characterId,
          party: "1",
        },
      },
    } as never);

    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);
  });

  it("rejects request_endorsement when the candidacy is not owned by the authenticated character", async () => {
    db.collectionMocks["electionCandidates"]!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        action: "request_endorsement",
        candidacyId: new ObjectId().toString(),
      }),
      { params: Promise.resolve({ id: nppId.toString() }) }
    );

    expect(response.status).toBe(400);
    expect(db.collectionMocks["characters"]!.findOneAndUpdate).not.toHaveBeenCalled();
    expect(db.collectionMocks["nppEndorsements"]!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["capitalActionLogs"]!.insertOne).not.toHaveBeenCalled();
  });

  it("rejects request_endorsement when the hidden relationship requirement is not met", async () => {
    const electionId = new ObjectId();
    db.collectionMocks["electionCandidates"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      electionId,
      characterId,
      characterName: "Player Candidate",
      party: "1",
      status: "active",
      isNPP: false,
      enteredAt: new Date(),
    });
    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: electionId,
      countryId: "US",
      electionType: "house",
      state: "US_CA",
      status: "active",
      primaryEndTime: new Date("2026-05-20T00:00:00Z"),
      endTime: new Date("2026-05-27T00:00:00Z"),
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        action: "request_endorsement",
        candidacyId: new ObjectId().toString(),
      }),
      { params: Promise.resolve({ id: nppId.toString() }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/likely to decline/i);
    expect(db.collectionMocks["capitalActionLogs"]!.insertOne).not.toHaveBeenCalled();
  });

  it("returns picker-level endorsement likelihood for active campaigns", async () => {
    const electionId = new ObjectId();
    db.collection("elections");
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: new ObjectId(),
            electionId,
            characterName: "Player Candidate",
          },
        ]),
      }),
    } as never);
    db.collectionMocks["elections"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: electionId,
            countryId: "US",
            electionType: "house",
            state: "US_CA",
          },
        ]),
      }),
    } as never);
    db.collectionMocks["nppRelationships"]!.findOne.mockResolvedValue({
      _id: `${characterId.toString()}_${nppId.toString()}`,
      relationshipScore: 42,
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/npps/123/direct-action"), {
      params: Promise.resolve({ id: nppId.toString() }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pickerOptions.candidacies).toEqual([
      expect.objectContaining({
        endorsementLikelihood: "likely_accept",
        canRequest: true,
      }),
    ]);
  });

  it("returns 404 from the interaction menu when the authenticated character record is missing", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValueOnce(null);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/npps/123/direct-action"), {
      params: Promise.resolve({ id: nppId.toString() }),
    });

    expect(response.status).toBe(404);
  });

  it("keeps boost actions enabled at negative relationship when actions and funds are sufficient", async () => {
    db.collectionMocks["nppRelationships"]!.findOne.mockResolvedValueOnce({
      _id: `${characterId.toString()}_${nppId.toString()}`,
      relationshipScore: -12,
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/npps/123/direct-action"), {
      params: Promise.resolve({ id: nppId.toString() }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.actions.find((action: { type: string }) => action.type === "boost_favorability")
    ).toEqual(
      expect.objectContaining({
        enabled: true,
        meetsRelationship: true,
      })
    );
    expect(
      body.actions.find((action: { type: string }) => action.type === "boost_influence")
    ).toEqual(
      expect.objectContaining({
        enabled: true,
        meetsRelationship: true,
      })
    );
  });

  it("uses forex-aware campaign funds for both panel display and action spending", async () => {
    const forexCharacter = {
      _id: characterId,
      actions: 30,
      funds: 0,
      currencyBalances: {
        campaign: 25_000,
        personal: {},
      },
      policies: { economic: 0, social: 0 },
    };
    db.collectionMocks["characters"]!.findOne.mockResolvedValueOnce(forexCharacter);
    db.collectionMocks["characters"]!.findOne.mockResolvedValueOnce(forexCharacter);
    db.collectionMocks["characters"]!.findOneAndUpdate.mockResolvedValueOnce({
      _id: characterId,
      actions: 24,
      funds: 0,
      currencyBalances: {
        campaign: 5_000,
        personal: {},
      },
    });

    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const { GET, POST } = await import("./route");
    const getResponse = await GET(new Request("http://localhost/api/npps/123/direct-action"), {
      params: Promise.resolve({ id: nppId.toString() }),
    });
    const getBody = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getBody.balance.funds).toBe(25_000);

    const postResponse = await POST(makeRequest({ action: "boost_influence" }), {
      params: Promise.resolve({ id: nppId.toString() }),
    });
    const postBody = await postResponse.json();

    expect(postResponse.status).toBe(200);
    // Post cf-inconsistency-fix: filter guards on the canonical local
    // stored balance, $inc writes only that field (no funds anchor mirror).
    expect(db.collectionMocks["characters"]!.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: characterId,
        actions: { $gte: 6 },
        "currencyBalances.campaign": { $gte: 20_000 },
      }),
      expect.objectContaining({
        $inc: expect.objectContaining({
          actions: -6,
          "currencyBalances.campaign": -20_000,
        }),
      }),
      expect.objectContaining({
        returnDocument: "after",
      })
    );
    expect(postBody.funds.current).toBe(5_000);
  });

  it("falls back to legacy funds when forex is enabled but the campaign balance has not been migrated yet", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValueOnce({
      _id: characterId,
      actions: 30,
      funds: 25_000,
      policies: { economic: 0, social: 0 },
    });
    db.collectionMocks["characters"]!.findOneAndUpdate.mockResolvedValueOnce({
      _id: characterId,
      actions: 24,
      funds: 5_000,
      policies: { economic: 0, social: 0 },
    });

    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const { GET, POST } = await import("./route");
    const getResponse = await GET(new Request("http://localhost/api/npps/123/direct-action"), {
      params: Promise.resolve({ id: nppId.toString() }),
    });
    const getBody = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getBody.balance.funds).toBe(25_000);

    const postResponse = await POST(makeRequest({ action: "boost_influence" }), {
      params: Promise.resolve({ id: nppId.toString() }),
    });
    const postBody = await postResponse.json();

    expect(postResponse.status).toBe(200);
    expect(db.collectionMocks["characters"]!.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: characterId,
        actions: { $gte: 6 },
        funds: { $gte: 20_000 },
      }),
      expect.objectContaining({
        $inc: expect.objectContaining({
          actions: -6,
          funds: -20_000,
        }),
      }),
      expect.objectContaining({
        returnDocument: "after",
      })
    );
    expect(postBody.funds.current).toBe(5_000);
  });

  it("applies favorability and influence boosts directly to the NPP", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ action: "boost_favorability" }), {
      params: Promise.resolve({ id: nppId.toString() }),
    });

    expect(response.status).toBe(200);
    expect(db.collectionMocks["npps"]!.updateOne).toHaveBeenCalledWith(
      { _id: nppId },
      expect.objectContaining({
        $set: expect.objectContaining({
          favorability: 53,
          politicalInfluence: 10,
        }),
      }),
      undefined
    );
    expect(db.collectionMocks["capitalActionLogs"]!.insertOne).toHaveBeenCalled();
  });

  it("applies reduce actions directly to the NPP and clamps downward changes", async () => {
    db.collectionMocks["npps"]!.findOne.mockResolvedValueOnce({
      _id: nppId,
      name: "Target NPP",
      countryId: "US",
      homeState: "US_CA",
      party: "1",
      currentOffice: { type: "house", state: "US_CA", seatsHeld: 1 },
      personality: { loyalty: 60, ambition: 50, stubbornness: 40 },
      policies: { economic: 0, social: 0 },
      politicalInfluence: 1,
      favorability: 2,
      generatedAt: new Date(),
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    db.collectionMocks["characters"]!.findOneAndUpdate.mockResolvedValueOnce({
      _id: characterId,
      actions: 25,
      funds: 40000,
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ action: "reduce_favorability" }), {
      params: Promise.resolve({ id: nppId.toString() }),
    });

    expect(response.status).toBe(200);
    expect(db.collectionMocks["npps"]!.updateOne).toHaveBeenCalledWith(
      { _id: nppId },
      expect.objectContaining({
        $set: expect.objectContaining({
          favorability: 0,
          politicalInfluence: 1,
        }),
      }),
      undefined
    );
  });

  it("rejects direct stat actions when campaign funds are insufficient", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValueOnce({
      _id: characterId,
      actions: 30,
      funds: 10000,
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ action: "boost_influence" }), {
      params: Promise.resolve({ id: nppId.toString() }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/campaign funds/i);
    expect(db.collectionMocks["characters"]!.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("refunds spent actions if a later write fails", async () => {
    db.collectionMocks["capitalActionLogs"]!.insertOne.mockRejectedValueOnce(
      new Error("write failed")
    );

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ action: "private_meeting" }), {
      params: Promise.resolve({ id: nppId.toString() }),
    });

    expect(response.status).toBe(500);
    expect(db.collectionMocks["characters"]!.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks["characters"]!.updateOne).toHaveBeenCalledWith(
      { _id: characterId },
      { $inc: { actions: 3, funds: 0 } }
    );
    expect(db.collectionMocks["nppRelationships"]!.replaceOne).toHaveBeenCalledWith(
      { _id: `${characterId.toString()}_${nppId.toString()}` },
      expect.objectContaining({
        relationshipScore: 25,
      }),
      { upsert: true }
    );
  });

  it("refunds both actions and funds if a later write fails on a funded stat action", async () => {
    db.collectionMocks["capitalActionLogs"]!.insertOne.mockRejectedValueOnce(
      new Error("write failed")
    );
    db.collectionMocks["characters"]!.findOneAndUpdate.mockResolvedValueOnce({
      _id: characterId,
      actions: 25,
      funds: 200000,
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ action: "boost_favorability" }), {
      params: Promise.resolve({ id: nppId.toString() }),
    });

    expect(response.status).toBe(500);
    expect(db.collectionMocks["characters"]!.updateOne).toHaveBeenCalledWith(
      { _id: characterId },
      { $inc: { actions: 5, funds: 10000 } }
    );
  });
});
