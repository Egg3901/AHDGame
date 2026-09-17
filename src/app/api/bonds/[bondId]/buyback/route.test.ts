import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { MARKET_MAKER_SPREAD } from "@/lib/constants/currencies";

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
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
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
  db.collection("corporations");
  db.collection("bondMarketPools");
  db.collection("nonAtomicMoneyFlowReceipts");
  db.collection("exchangeRates");
});

const corpId = new ObjectId();

async function mockAuthAndCorp(overrides: Record<string, unknown> = {}) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "user-1" },
  } as never);

  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: {
      _id: corpId,
      ceoId: new ObjectId(),
      countryId: "US",
      liquidCapital: 500_000,
      liquidCurrencyCode: "USD",
      ...overrides,
    },
  } as never);
  vi.mocked(requireCeo).mockReturnValue(null);
}

function mockBondFinds(first: Record<string, unknown>, refreshed: Record<string, unknown>) {
  // Calls in order: initial bond read, then (on the race path) the claim
  // disambiguation read, then the post-commit refreshed read.
  const findOne = db.collectionMocks.bonds.findOne;
  findOne.mockReset();
  findOne.mockResolvedValueOnce(first).mockResolvedValueOnce(first).mockResolvedValue(refreshed);
}

function postBuyback(
  body: Record<string, unknown>,
  headers?: Record<string, string>,
  bondId?: string
) {
  return import("./route").then(({ POST }) =>
    POST(
      new Request("http://localhost/api/bonds/x/buyback", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(headers ?? {}) },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ bondId: bondId ?? new ObjectId().toString() }) }
    )
  );
}

const baseBond = {
  corporationId: corpId,
  matured: false,
  publicFloat: 5,
  totalIssued: 5_000,
  holders: [],
  defaulted: false,
  marketPrice: 1,
  currencyCode: "USD",
  countryId: "US",
};

describe("POST /api/bonds/[bondId]/buyback", () => {
  it("compensates the corporation debit when the public-float claim loses the race", async () => {
    const bondId = new ObjectId();
    await mockAuthAndCorp();
    mockBondFinds({ _id: bondId, ...baseBond }, { _id: bondId, publicFloat: 1 });
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ modifiedCount: 0, matchedCount: 0 });

    const response = await postBuyback({ units: 3 }, undefined, bondId.toHexString());

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Only 1 units available");
    // The debit landed first, so the compensation refunds it with a
    // compensation key instead of stranding corp funds.
    const corpCalls = db.collectionMocks.corporations.updateOne.mock.calls;
    expect(corpCalls.length).toBe(2);
    expect(corpCalls[1]?.[1]).toEqual(
      expect.objectContaining({
        $inc: expect.objectContaining({ liquidCapital: expect.any(Number) }),
      })
    );
    const push = (corpCalls[1]?.[1] as { $push: Record<string, unknown> }).$push;
    expect(JSON.stringify(push)).toContain("compensate:corp-debit");
  });

  it("includes FX spread when a corporation buys back foreign-currency bonds", async () => {
    const bondId = new ObjectId();
    await mockAuthAndCorp({ countryId: "GB", liquidCurrencyCode: "GBP" });

    const { loadFxRatesRecord } = await import("@/lib/currency/corporationCapital");
    vi.mocked(loadFxRatesRecord).mockResolvedValue({ USD: 0.75, GBP: 1 });

    mockBondFinds(
      { _id: bondId, ...baseBond },
      { _id: bondId, publicFloat: 2, totalIssued: 2_000, holders: [], matured: false }
    );
    db.collectionMocks.exchangeRates.findOne.mockResolvedValue({ currencyCode: "GBP", rate: 1 });
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });

    const response = await postBuyback({ units: 3 }, undefined, bondId.toHexString());

    expect(response.status).toBe(200);
    const debitCall = db.collectionMocks.corporations.updateOne.mock.calls[0];
    expect(debitCall?.[0]).toEqual(
      expect.objectContaining({
        _id: corpId,
        liquidCapital: { $gte: 3060 / ((1 - MARKET_MAKER_SPREAD) * 0.75) },
      })
    );
    expect(debitCall?.[1]).toEqual(
      expect.objectContaining({
        $inc: { liquidCapital: -(3060 / ((1 - MARKET_MAKER_SPREAD) * 0.75)) },
      })
    );
    // The spread now routes inside the keyed flow (not post-commit), so the
    // central-bank slice is written before the route returns success.
    expect(db.collectionMocks.centralBanks.updateOne).toHaveBeenCalled();
  });

  it("rejects an invalid Idempotency-Key header without touching money", async () => {
    await mockAuthAndCorp();

    const response = await postBuyback({ units: 3 }, { "Idempotency-Key": "" });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Invalid Idempotency-Key header");
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.bonds.updateOne).not.toHaveBeenCalled();
  });

  it("replays the same Idempotency-Key without moving money again", async () => {
    const bondId = new ObjectId();
    await mockAuthAndCorp();
    mockBondFinds(
      { _id: bondId, ...baseBond },
      { _id: bondId, publicFloat: 2, totalIssued: 2_000, holders: [], matured: false }
    );
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });

    const headers = { "Idempotency-Key": "buyback-replay-key" };
    const first = await postBuyback({ units: 3 }, headers, bondId.toHexString());
    expect(first.status).toBe(200);

    // The stored receipt now completes the same key: the claim collides and
    // the disambiguation read reports the completed flow. The fingerprint is
    // captured from the first attempt so the replay presents the same one.
    const receipts = db.collectionMocks.nonAtomicMoneyFlowReceipts;
    const firstFingerprint = (receipts.insertOne.mock.calls[0]?.[0] as { fingerprint: string })
      .fingerprint;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "buyback-replay-key",
      status: "completed",
      fingerprint: firstFingerprint,
    });
    mockBondFinds(
      { _id: bondId, ...baseBond },
      { _id: bondId, publicFloat: 2, totalIssued: 2_000, holders: [], matured: false }
    );

    const debitCalls = db.collectionMocks.corporations.updateOne.mock.calls.length;
    const second = await postBuyback({ units: 3 }, headers, bondId.toHexString());
    expect(second.status).toBe(200);
    // No second corp debit: the replay converged on the stored outcome.
    expect(db.collectionMocks.corporations.updateOne.mock.calls.length).toBe(debitCalls);
  });

  it("maps a reused key for a different buyback to 409", async () => {
    const bondId = new ObjectId();
    await mockAuthAndCorp();
    mockBondFinds(
      { _id: bondId, ...baseBond },
      { _id: bondId, publicFloat: 2, totalIssued: 2_000, holders: [], matured: false }
    );

    const receipts = db.collectionMocks.nonAtomicMoneyFlowReceipts;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "buyback-conflict-key",
      status: "completed",
      fingerprint: "bond-buyback:something-else",
    });

    const response = await postBuyback(
      { units: 3 },
      { "Idempotency-Key": "buyback-conflict-key" },
      bondId.toHexString()
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("different buyback");
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });
});
