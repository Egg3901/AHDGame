import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
  getMongoClient: vi.fn(async () => ({
    startSession: () => ({
      withTransaction: vi.fn(async () => {
        const err = new Error("transactions not supported on standalone") as Error & {
          code?: number;
        };
        err.code = 20;
        throw err;
      }),
      endSession: vi.fn(async () => {}),
    }),
  })),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/rejectDuringTurn", () => ({
  rejectDuringTurn: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/bonds/marketPool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bonds/marketPool")>();
  return {
    ...actual,
    loadBondQuote: vi.fn().mockResolvedValue({ askPerUnit: 1020, ask: 1.02 }),
  };
});
vi.mock("@/lib/currency/corporationCapital", async () => {
  const actual = await vi.importActual<typeof import("@/lib/currency/corporationCapital")>(
    "@/lib/currency/corporationCapital"
  );
  return {
    ...actual,
    loadFxRatesRecord: vi.fn().mockResolvedValue({ USD: 1 }),
  };
});

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("bonds");
  db.collection("characters");
  db.collection("users");
  db.collection("corporations");
  db.collection("gameState");
  db.collection("bondMarketPools");
  db.collection("nonAtomicMoneyFlowReceipts");
  db.collection("exchangeRates");
  db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 506 });
  db.collectionMocks.exchangeRates.findOne.mockResolvedValue({ currencyCode: "USD", rate: 1 });
});

const ASK_PER_UNIT = 1020;

function baseBond(bondId: ObjectId) {
  return {
    _id: bondId,
    matured: false,
    publicFloat: 100,
    marketPrice: 1,
    currencyCode: "USD",
    countryId: "US",
    issuerType: "corporation",
    issuerName: "Test Corp",
    holders: [],
  };
}

async function mockAuth(userId: ObjectId) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: userId.toString() },
  } as never);
}

function postBuy(
  body: Record<string, unknown>,
  headers?: Record<string, string>,
  bondId?: string,
  query?: string
) {
  return import("./route").then(({ POST }) =>
    POST(
      new Request(`http://localhost/api/bonds/x/buy${query ?? ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(headers ?? {}) },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ bondId: bondId ?? new ObjectId().toString() }) }
    )
  );
}

describe("POST /api/bonds/[bondId]/buy", () => {
  it("rejects an invalid Idempotency-Key header without touching money", async () => {
    const bondId = new ObjectId();
    const userId = new ObjectId();
    await mockAuth(userId);

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/bonds/x/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "" },
        body: JSON.stringify({ units: 3 }),
      }),
      { params: Promise.resolve({ bondId: bondId.toString() }) }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Invalid Idempotency-Key header");
    expect(db.collectionMocks.bonds.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("buys as character: guarded debit, keyed reserve, pool credit", async () => {
    const bondId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();
    await mockAuth(userId);

    db.collectionMocks.bonds.findOne.mockResolvedValue(baseBond(bondId));
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: characterId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Buyer",
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);

    const response = await postBuy({ units: 3 }, undefined, bondId.toHexString());

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      success: true,
      unitsBought: 3,
      cost: 3 * ASK_PER_UNIT,
      costCurrency: "USD",
      pricePerUnit: ASK_PER_UNIT,
      buyer: "character",
      spreadPaid: 0,
    });
    // Guarded debit with the flow key.
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: characterId,
        cashOnHand: { $gte: 3 * ASK_PER_UNIT },
      }),
      expect.objectContaining({ $inc: expect.objectContaining({ cashOnHand: -3 * ASK_PER_UNIT }) }),
      undefined
    );
    // Keyed holder reservation moves the float.
    const bondUpdates = db.collectionMocks.bonds.updateOne.mock.calls.map((call) => call[1]);
    expect(JSON.stringify(bondUpdates)).toContain('"holders.$.units":3');
    // Pool credit carries the purchasesIn counter.
    expect(db.collectionMocks.bondMarketPools.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "USD" }),
      expect.objectContaining({
        $inc: expect.objectContaining({
          cashLocal: 3 * ASK_PER_UNIT,
          "lifetime.purchasesIn": 3 * ASK_PER_UNIT,
        }),
      }),
      undefined
    );
  });

  it("replays the same Idempotency-Key without moving money again", async () => {
    const bondId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();
    await mockAuth(userId);

    db.collectionMocks.bonds.findOne.mockResolvedValue(baseBond(bondId));
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: characterId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Buyer",
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);

    const headers = { "Idempotency-Key": "buy-replay-key" };
    const fingerprint = `bond-buy:${bondId.toHexString()}:character:${characterId.toHexString()}:3:${3 * ASK_PER_UNIT}`;

    const first = await postBuy({ units: 3 }, headers, bondId.toHexString());
    expect(first.status).toBe(200);
    const debitWrites = (): number =>
      db.collectionMocks.characters.updateOne.mock.calls.filter(
        (call) =>
          (call[1] as { $inc?: Record<string, number> }).$inc?.cashOnHand === -3 * ASK_PER_UNIT
      ).length;
    expect(debitWrites()).toBe(1);

    // The stored receipt settles the retry as a duplicate.
    const receipts = db.collection("nonAtomicMoneyFlowReceipts");
    const duplicateKeyError = new Error("E11000 duplicate key") as Error & { code: number };
    duplicateKeyError.code = 11000;
    receipts.insertOne.mockRejectedValueOnce(duplicateKeyError);
    receipts.findOne.mockResolvedValue({
      _id: "buy-replay-key",
      status: "completed",
      fingerprint,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const second = await postBuy({ units: 3 }, headers, bondId.toHexString());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(debitWrites()).toBe(1);
  });

  it("returns 400 with the historical body when funds are insufficient", async () => {
    const bondId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();
    await mockAuth(userId);

    db.collectionMocks.bonds.findOne.mockResolvedValue(baseBond(bondId));
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: characterId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Buyer",
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    // Debit guard rejects; no holder write follows.
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
    db.collectionMocks.characters.findOne
      .mockResolvedValueOnce({
        _id: characterId,
        userId,
        name: "Buyer",
        countryId: "US",
      })
      .mockResolvedValue({ _id: characterId, cashOnHand: 10 });

    const response = await postBuy({ units: 3 }, undefined, bondId.toHexString());

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Insufficient funds");
    expect(db.collectionMocks.bonds.updateOne).not.toHaveBeenCalled();
  });

  it("returns 409 when the key is reused for a different purchase", async () => {
    const bondId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();
    await mockAuth(userId);

    db.collectionMocks.bonds.findOne.mockResolvedValue(baseBond(bondId));
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: characterId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Buyer",
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);

    const headers = { "Idempotency-Key": "buy-conflict-key" };
    const first = await postBuy({ units: 3 }, headers, bondId.toHexString());
    expect(first.status).toBe(200);

    // Same key, different units: the stored receipt's fingerprint no longer
    // matches, so the claim throws instead of replaying.
    const receipts = db.collection("nonAtomicMoneyFlowReceipts");
    const duplicateKeyError = new Error("E11000 duplicate key") as Error & { code: number };
    duplicateKeyError.code = 11000;
    receipts.insertOne.mockRejectedValueOnce(duplicateKeyError);
    receipts.findOne.mockResolvedValue({
      _id: "buy-conflict-key",
      status: "completed",
      fingerprint: `bond-buy:${bondId.toHexString()}:character:${characterId.toHexString()}:3:${3 * ASK_PER_UNIT}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const second = await postBuy({ units: 5 }, headers, bondId.toHexString());
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("Idempotency key was reused for a different purchase.");
  });

  it("compensates the debit and reports the refreshed float when the reserve loses the race", async () => {
    const bondId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();
    await mockAuth(userId);

    // The initial read sees a full float (passes the pre-check); every bond
    // write then misses because the float raced away mid-flight.
    db.collectionMocks.bonds.findOne
      .mockResolvedValueOnce(baseBond(bondId))
      .mockResolvedValue({ ...baseBond(bondId), publicFloat: 2 });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: characterId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Buyer",
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    const response = await postBuy({ units: 3 }, undefined, bondId.toHexString());

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Only 2 units available");
    // Debit landed, then the compensation refunded it with a compensation key.
    const charCalls = db.collectionMocks.characters.updateOne.mock.calls;
    expect(charCalls.length).toBe(2);
    const push = (charCalls[1]?.[1] as { $push: Record<string, unknown> }).$push;
    expect(JSON.stringify(push)).toContain("compensate:buyer-debit");
  });

  it("buys as corporation with a guarded liquidCapital debit", async () => {
    const bondId = new ObjectId();
    const corpId = new ObjectId();
    const userId = new ObjectId();
    await mockAuth(userId);

    db.collectionMocks.bonds.findOne.mockResolvedValue({
      ...baseBond(bondId),
      corporationId: new ObjectId(),
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      userId,
      name: "BuyerCorp",
      liquidCapital: 500_000,
      liquidCurrencyCode: "USD",
      countryId: "US",
    });

    const response = await postBuy(
      { units: 3 },
      undefined,
      bondId.toHexString(),
      `?corporationId=${corpId.toHexString()}`
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ success: true, unitsBought: 3, buyer: "corporation" });
    expect(db.collectionMocks.corporations.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: corpId,
        liquidCapital: { $gte: 3 * ASK_PER_UNIT },
      }),
      expect.objectContaining({
        $inc: expect.objectContaining({ liquidCapital: -3 * ASK_PER_UNIT }),
      }),
      undefined
    );
  });
});
