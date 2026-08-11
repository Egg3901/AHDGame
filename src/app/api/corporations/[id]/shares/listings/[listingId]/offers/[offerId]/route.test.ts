import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit: vi.fn().mockReturnValue({ ok: true }) }));
vi.mock("@/lib/db/characterLookup", () => ({ getCharacterByUserId: vi.fn() }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(12) }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);
});

describe("DELETE /api/corporations/[id]/shares/listings/[listingId]/offers/[offerId]", () => {
  it("returns 503 before cancelling the offer when buyer FX is unavailable", async () => {
    const userId = new ObjectId();
    const buyerId = new ObjectId();
    const offerId = new ObjectId();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: buyerId,
      userId,
      name: "Buyer",
      countryId: "UK",
    } as any);

    db.collection("shareOffers");
    db.collectionMocks["shareOffers"].findOne.mockResolvedValue({
      _id: offerId,
      listingId: new ObjectId(),
      corporationId: corpId,
      buyerCharacterId: buyerId,
      shares: 10,
      pricePerShare: 1000,
      escrowAmount: 10_000,
      status: "pending",
      createdAt: new Date(),
    });

    db.collection("corporations");
    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: corpId,
      countryId: "JP",
      liquidCurrencyCode: "JPY",
    });

    db.collection("exchangeRates");
    db.collectionMocks["exchangeRates"].findOne.mockImplementation(
      (filter: { currencyCode?: string }) => {
        if (filter?.currencyCode === "JPY") {
          return Promise.resolve({ currencyCode: "JPY", rate: 100 });
        }
        return Promise.resolve(null);
      }
    );

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: "corp", listingId: "listing", offerId: offerId.toString() }),
    });
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error).toContain("Exchange rate unavailable");
    expect(db.collectionMocks["shareOffers"].updateOne).not.toHaveBeenCalled();
  });

  it("reopens the offer and reverses the refund if settlement fails after the cash credit", async () => {
    const userId = new ObjectId();
    const buyerId = new ObjectId();
    const offerId = new ObjectId();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: buyerId,
      userId,
      name: "Buyer",
      countryId: "UK",
    } as any);

    db.collection("shareOffers");
    db.collectionMocks["shareOffers"].findOne.mockResolvedValue({
      _id: offerId,
      listingId: new ObjectId(),
      corporationId: corpId,
      buyerCharacterId: buyerId,
      shares: 10,
      pricePerShare: 1000,
      escrowAmount: 10_000,
      status: "pending",
      createdAt: new Date(),
    });
    db.collectionMocks["shareOffers"].updateOne
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

    db.collection("corporations");
    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: corpId,
      countryId: "JP",
      liquidCurrencyCode: "JPY",
    });

    db.collection("exchangeRates");
    db.collectionMocks["exchangeRates"].findOne.mockImplementation(
      (filter: { currencyCode?: string }) => {
        if (filter?.currencyCode === "JPY") {
          return Promise.resolve({ currencyCode: "JPY", rate: 100 });
        }
        if (filter?.currencyCode === "GBP") {
          return Promise.resolve({ currencyCode: "GBP", rate: 0.75 });
        }
        return Promise.resolve(null);
      }
    );

    db.collection("characters");
    db.collectionMocks["characters"].updateOne
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.mocked(emitTx).mockRejectedValueOnce(new Error("ledger failed"));

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: "corp", listingId: "listing", offerId: offerId.toString() }),
    });

    expect(res.status).toBe(500);
    expect(db.collectionMocks["characters"].updateOne).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks["characters"].updateOne.mock.calls[1]?.[1]).toMatchObject({
      $inc: expect.objectContaining({
        "currencyBalances.personal.GBP": -75,
      }),
    });
    expect(db.collectionMocks["shareOffers"].updateOne.mock.calls[1]?.[1]).toMatchObject({
      $set: { status: "pending" },
    });
  });
});
