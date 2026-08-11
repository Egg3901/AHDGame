import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { MARKET_MAKER_SPREAD } from "@/lib/constants/currencies";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
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
  db.collection("exchangeRates");
});

describe("POST /api/bonds/[bondId]/buyback", () => {
  it("refunds the corporation when the public-float claim loses the race", async () => {
    const bondId = new ObjectId();
    const corpId = new ObjectId();

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
      },
    } as never);
    vi.mocked(requireCeo).mockReturnValue(null);

    db.collectionMocks.bonds.findOne
      .mockResolvedValueOnce({
        _id: bondId,
        corporationId: corpId,
        matured: false,
        publicFloat: 5,
        totalIssued: 5_000,
        holders: [],
        defaulted: false,
        marketPrice: 1,
        currencyCode: "USD",
        countryId: "US",
      })
      .mockResolvedValueOnce({
        _id: bondId,
        publicFloat: 1,
      });
    db.collectionMocks.exchangeRates.findOne.mockResolvedValue({ currencyCode: "USD", rate: 1 });
    db.collectionMocks.corporations.updateOne
      .mockResolvedValueOnce({ modifiedCount: 1, matchedCount: 1 })
      .mockResolvedValueOnce({ modifiedCount: 1, matchedCount: 1 });
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ modifiedCount: 0, matchedCount: 1 });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/bonds/x/buyback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: 3 }),
      }),
      { params: Promise.resolve({ bondId: bondId.toString() }) }
    );

    expect(response.status).toBe(400);
    expect(db.collectionMocks.corporations.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: corpId },
      expect.objectContaining({
        $inc: expect.objectContaining({ liquidCapital: expect.any(Number) }),
      })
    );
  });

  it("includes FX spread when a corporation buys back foreign-currency bonds", async () => {
    const bondId = new ObjectId();
    const corpId = new ObjectId();

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
        countryId: "GB",
        liquidCapital: 500_000,
        liquidCurrencyCode: "GBP",
      },
    } as never);
    vi.mocked(requireCeo).mockReturnValue(null);

    const { loadFxRatesRecord } = await import("@/lib/currency/corporationCapital");
    vi.mocked(loadFxRatesRecord).mockResolvedValue({ USD: 0.75, GBP: 1 });

    db.collectionMocks.bonds.findOne
      .mockResolvedValueOnce({
        _id: bondId,
        corporationId: corpId,
        matured: false,
        publicFloat: 5,
        totalIssued: 5_000,
        holders: [],
        defaulted: false,
        marketPrice: 1,
        currencyCode: "USD",
        countryId: "US",
      })
      .mockResolvedValueOnce({
        _id: bondId,
        publicFloat: 2,
        totalIssued: 2_000,
        holders: [],
        matured: false,
      });
    db.collectionMocks.exchangeRates.findOne.mockResolvedValue({ currencyCode: "GBP", rate: 1 });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/bonds/x/buyback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: 3 }),
      }),
      { params: Promise.resolve({ bondId: bondId.toString() }) }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.corporations.updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: corpId, liquidCapital: { $gte: 3000 / ((1 - MARKET_MAKER_SPREAD) * 0.75) } },
      {
        $inc: { liquidCapital: -(3000 / ((1 - MARKET_MAKER_SPREAD) * 0.75)) },
        $set: { updatedAt: expect.any(Date) },
      }
    );
  });
});
