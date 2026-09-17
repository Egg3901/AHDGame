import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { DirectActionBalanceConflictError } from "@/lib/npps/commands/directAction";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/npps/commands/directAction", async () => {
  const actual = await vi.importActual<typeof import("@/lib/npps/commands/directAction")>(
    "@/lib/npps/commands/directAction"
  );
  return { ...actual, applyNppDirectAction: vi.fn() };
});

function makeRequest(body: Record<string, unknown>, headers?: Record<string, string>) {
  return new Request("http://localhost/api/npps/123/direct-action", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/npps/[id]/direct-action", () => {
  let db: MockDb;
  let characterId: ObjectId;
  let nppId: ObjectId;

  const successResult = {
    success: true,
    effect: "Favorability boosted.",
    action: "boost_favorability",
    actions: { current: 25, spent: 5 },
    funds: { current: 40000, spent: 10000 },
    homeCurrency: "USD",
    currencySymbol: "$",
    relationship: { before: 25, after: 27, delta: 2 },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    characterId = new ObjectId();
    nppId = new ObjectId();

    db.collection("npps");
    db.collection("characters");
    db.collection("nppRelationships");
    db.collection("gameState");

    db.collectionMocks["npps"]!.findOne.mockResolvedValue({
      _id: nppId,
      name: "Target NPP",
      countryId: "US",
      homeState: "US_CA",
      party: "1",
      policies: { economic: 0, social: 0 },
      politicalInfluence: 10,
      favorability: 50,
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: characterId,
      actions: 30,
      funds: 50000,
      policies: { economic: 0, social: 0 },
      countryId: "US",
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

    const { applyNppDirectAction } = await import("@/lib/npps/commands/directAction");
    vi.mocked(applyNppDirectAction).mockResolvedValue(successResult as never);
  });

  it("returns 400 for an invalid NPP id", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ action: "boost_favorability" }), {
      params: Promise.resolve({ id: "not-an-id" }),
    });
    expect(response.status).toBe(400);
  });

  it("returns 400 for an empty Idempotency-Key header", async () => {
    const { POST } = await import("./route");
    const { applyNppDirectAction } = await import("@/lib/npps/commands/directAction");
    const response = await POST(
      makeRequest({ action: "boost_favorability" }, { "Idempotency-Key": "" }),
      { params: Promise.resolve({ id: nppId.toString() }) }
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/idempotency/i);
    expect(applyNppDirectAction).not.toHaveBeenCalled();
  });

  it("returns 400 for an over-long Idempotency-Key header", async () => {
    const { POST } = await import("./route");
    const { applyNppDirectAction } = await import("@/lib/npps/commands/directAction");
    const response = await POST(
      makeRequest({ action: "boost_favorability" }, { "Idempotency-Key": "k".repeat(129) }),
      { params: Promise.resolve({ id: nppId.toString() }) }
    );
    expect(response.status).toBe(400);
    expect(applyNppDirectAction).not.toHaveBeenCalled();
  });

  it("forwards a client Idempotency-Key to the command", async () => {
    const { POST } = await import("./route");
    const { applyNppDirectAction } = await import("@/lib/npps/commands/directAction");
    const response = await POST(
      makeRequest({ action: "boost_favorability" }, { "Idempotency-Key": "client-key-1" }),
      { params: Promise.resolve({ id: nppId.toString() }) }
    );

    expect(response.status).toBe(200);
    expect(applyNppDirectAction).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ action: "boost_favorability", idempotencyKey: "client-key-1" })
    );
  });

  it("omits the key when the header is absent so the command mints one", async () => {
    const { POST } = await import("./route");
    const { applyNppDirectAction } = await import("@/lib/npps/commands/directAction");
    const response = await POST(makeRequest({ action: "private_meeting" }), {
      params: Promise.resolve({ id: nppId.toString() }),
    });

    expect(response.status).toBe(200);
    const args = vi.mocked(applyNppDirectAction).mock.calls[0]![1];
    expect(args).not.toHaveProperty("idempotencyKey");
  });

  it("returns the command result unchanged on success", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ action: "boost_favorability" }), {
      params: Promise.resolve({ id: nppId.toString() }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(successResult);
  });

  it("maps a raced debit to 409", async () => {
    const { POST } = await import("./route");
    const { applyNppDirectAction } = await import("@/lib/npps/commands/directAction");
    vi.mocked(applyNppDirectAction).mockRejectedValueOnce(
      new DirectActionBalanceConflictError(
        "Action balance changed mid-interaction; reload and try again."
      )
    );

    const response = await POST(makeRequest({ action: "boost_favorability" }), {
      params: Promise.resolve({ id: nppId.toString() }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Action balance changed mid-interaction; reload and try again.",
    });
  });

  it("maps a settled key to 409", async () => {
    const { POST } = await import("./route");
    const { applyNppDirectAction } = await import("@/lib/npps/commands/directAction");
    vi.mocked(applyNppDirectAction).mockRejectedValueOnce(
      new MoneyFlowTerminalError("k", "compensated")
    );

    const response = await POST(makeRequest({ action: "boost_favorability" }), {
      params: Promise.resolve({ id: nppId.toString() }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/settled/i);
  });

  it("maps a reused key to 409", async () => {
    const { POST } = await import("./route");
    const { applyNppDirectAction } = await import("@/lib/npps/commands/directAction");
    vi.mocked(applyNppDirectAction).mockRejectedValueOnce(new MoneyFlowKeyConflictError("k"));

    const response = await POST(makeRequest({ action: "boost_favorability" }), {
      params: Promise.resolve({ id: nppId.toString() }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/different action/i);
  });

  it("returns 400 for a failed spend validation without claiming anything", async () => {
    const { POST } = await import("./route");
    const { applyNppDirectAction } = await import("@/lib/npps/commands/directAction");
    vi.mocked(applyNppDirectAction).mockResolvedValueOnce({
      error: "Need 5 actions - you have 0.",
      failure: "insufficient_capital",
      status: 400,
    } as never);

    const response = await POST(makeRequest({ action: "boost_favorability" }), {
      params: Promise.resolve({ id: nppId.toString() }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({
      error: "Need 5 actions - you have 0.",
      failure: "insufficient_capital",
    });
  });
});

describe("GET /api/npps/[id]/direct-action", () => {
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
});
