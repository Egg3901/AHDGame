import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

let db: MockDb;
beforeEach(async () => {
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("recordShareTrade", () => {
  it("inserts a document with computed totalAnchor and ISO date", async () => {
    const { recordShareTrade } = await import("./shareTradeHistory");
    const corpId = new ObjectId();
    const toCharId = new ObjectId();
    await recordShareTrade(db as unknown as Db, {
      corporationId: corpId,
      kind: "market_buy",
      turn: 257,
      shares: 10,
      pricePerShareAnchor: 100,
      from: null,
      to: { characterId: toCharId, name: "Buyer" },
    });
    const coll = db.collectionMocks["shareTradeHistory"]!;
    expect(coll.insertOne).toHaveBeenCalledTimes(1);
    const doc = coll.insertOne.mock.calls[0][0];
    expect(doc.corporationId).toBe(corpId);
    expect(doc.kind).toBe("market_buy");
    expect(doc.turn).toBe(257);
    expect(doc.shares).toBe(10);
    expect(doc.pricePerShareAnchor).toBe(100);
    expect(doc.totalAnchor).toBe(1000);
    expect(doc.from).toBeNull();
    expect(doc.to).toEqual({ characterId: toCharId, name: "Buyer" });
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.corpCurrencyCode).toBeUndefined();
    expect(doc.note).toBeUndefined();
  });

  it("includes corpCurrencyCode and note when provided", async () => {
    const { recordShareTrade } = await import("./shareTradeHistory");
    await recordShareTrade(db as unknown as Db, {
      corporationId: new ObjectId(),
      kind: "correction",
      turn: 1,
      shares: 5,
      pricePerShareAnchor: 200,
      from: null,
      to: null,
      corpCurrencyCode: "USD",
      note: "refund + 25% goodwill bonus",
    });
    const doc = db.collectionMocks["shareTradeHistory"]!.insertOne.mock.calls[0][0];
    expect(doc.corpCurrencyCode).toBe("USD");
    expect(doc.note).toBe("refund + 25% goodwill bonus");
  });

  it("rounds totalAnchor to two decimal places", async () => {
    const { recordShareTrade } = await import("./shareTradeHistory");
    await recordShareTrade(db as unknown as Db, {
      corporationId: new ObjectId(),
      kind: "market_buy",
      turn: 1,
      shares: 3,
      pricePerShareAnchor: 585.0432613398355,
      from: null,
      to: { characterId: new ObjectId(), name: "Buyer" },
    });
    const doc = db.collectionMocks["shareTradeHistory"]!.insertOne.mock.calls[0][0];
    expect(doc.totalAnchor).toBe(1755.13);
  });

  it("swallows insert errors and reports them to Sentry", async () => {
    const { recordShareTrade } = await import("./shareTradeHistory");
    // Trigger lazy-creation of the collection mock, then make insertOne reject.
    db.collection("shareTradeHistory");
    db.collectionMocks["shareTradeHistory"]!.insertOne.mockRejectedValueOnce(new Error("boom"));
    const sentry = await import("@sentry/nextjs");
    await expect(
      recordShareTrade(db as unknown as Db, {
        corporationId: new ObjectId(),
        kind: "issuance",
        turn: 1,
        shares: 1,
        pricePerShareAnchor: 1,
        from: null,
        to: null,
      })
    ).resolves.toBeUndefined();
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
