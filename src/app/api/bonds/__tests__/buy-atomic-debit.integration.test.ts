/**
 * Regression: bond buy must deduct cash atomically with a `$gte` filter.
 *
 * Pre-fix the route did:
 *   1. read character doc, check balance
 *   2. push holders.units
 *   3. decrement publicFloat
 *   4. $inc -costLocal on currencyBalances.personal.<code>  ← NO balance filter
 *   5. fire-and-forget emitTx
 *
 * Concurrent requests against the same character could both pass the read-side
 * check on stale data, and one of the four writes silently dropping (the live
 * mode against production) left bond holdings credited while cash never moved.
 *
 * Post-fix, deduction goes through `atomicallyDebitCharacterCash` which uses
 * `findOneAndUpdate` with a `$gte` filter. These tests assert that contract:
 *   - 400 returned when the guard reports insufficient
 *   - 200 + holder write + emitTx when the guard succeeds
 *   - refund issued if the holder write throws after the cash is debited
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/currency/autoConvert", () => ({
  autoConvertForPurchase: vi.fn().mockResolvedValue({ needed: false, success: true }),
  convertForExplicitPay: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("bond buy — atomic balance-gated debit (regression)", () => {
  let db: MockDb;
  const userId = new ObjectId().toString();
  const charId = new ObjectId();
  const bondId = new ObjectId();
  const issuerCorpId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "bonds",
      "corporations",
      "characters",
      "users",
      "gameState",
      "exchangeRates",
      "imperialCharacters",
    ]) {
      db.collection(name);
    }
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,

      user: { userId, username: "tester", isAdmin: false } as any,
    });

    db.collectionMocks["users"]!.findOne.mockResolvedValue({
      _id: new ObjectId(userId),
      activeCharacterId: charId,
      activeCharacterType: "regular",
    });
    db.collectionMocks["bonds"]!.findOne.mockResolvedValue({
      _id: bondId,
      currencyCode: "USD",
      countryId: "US",
      corporationId: issuerCorpId,
      issuerType: "sovereign",
      faceValue: 1000,
      marketPrice: 1.0,
      publicFloat: 10_000,
      holders: [],
      matured: false,
      defaulted: false,
    });
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: issuerCorpId,
      ceoId: new ObjectId(), // not the buyer
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: charId,
      userId: new ObjectId(userId),
      name: "Test Buyer",
      countryId: "US",
      currencyBalances: { personal: { USD: 1_000_000 }, savings: {}, campaign: 0 },
    });
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 100,
      forexEnabled: true,
    });
    db.collectionMocks["exchangeRates"]!.findOne.mockResolvedValue({
      currencyCode: "USD",
      rate: 1.0,
    });
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(
      makeCursor([{ currencyCode: "USD", rate: 1.0 }])
    );
  });

  it("returns 400 when the atomic debit guard reports insufficient funds", async () => {
    // Cost = 1000 units × $1000 face × 1.01 ask (mid 1.0 + 1% sovereign half spread) = $1,010,000.
    // Pre-buy the character has $1M, so the SECOND of two parallel buys would
    // fail. We simulate that here by having findOneAndUpdate return null.
    db.collectionMocks["characters"]!.findOneAndUpdate.mockResolvedValue(null);

    const url = `http://test.local/api/bonds/${bondId.toString()}/buy`;
    const req = new Request(url, {
      method: "POST",
      body: JSON.stringify({ units: 1000 }),
      headers: { "content-type": "application/json" },
    });

    const { POST } = await import("../[bondId]/buy/route");
    const res = await POST(req, { params: Promise.resolve({ bondId: bondId.toString() }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/insufficient/i);

    // Critical: no holders were written, no tx emitted.
    const holderWrites = db.collectionMocks["bonds"]!.updateOne.mock.calls.filter(
      (c: unknown[]) => {
        const update = c[1] as Record<string, unknown>;
        return (
          (update.$push as Record<string, unknown> | undefined)?.holders !== undefined ||
          (update.$inc as Record<string, unknown> | undefined)?.["holders.$.units"] !== undefined
        );
      }
    );
    expect(holderWrites).toHaveLength(0);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTx)).not.toHaveBeenCalled();
  });

  it("uses findOneAndUpdate with $gte filter on currencyBalances.personal.USD", async () => {
    db.collectionMocks["characters"]!.findOneAndUpdate.mockResolvedValue({
      _id: charId,
      currencyBalances: { personal: { USD: 0 }, savings: {}, campaign: 0 },
    });

    const url = `http://test.local/api/bonds/${bondId.toString()}/buy`;
    const req = new Request(url, {
      method: "POST",
      body: JSON.stringify({ units: 1000 }),
      headers: { "content-type": "application/json" },
    });

    const { POST } = await import("../[bondId]/buy/route");
    const res = await POST(req, { params: Promise.resolve({ bondId: bondId.toString() }) });

    expect(res.status).toBe(200);

    // Verify the deduction was a $gte-gated atomic write — not a naive $inc.
    const calls = db.collectionMocks["characters"]!.findOneAndUpdate.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const filter = calls[0][0] as Record<string, unknown>;
    expect(filter._id).toEqual(charId);
    const balanceField = filter["currencyBalances.personal.USD"] as { $gte?: number };
    expect(balanceField?.$gte).toBe(1_010_000);

    const update = calls[0][1] as { $inc: Record<string, number> };
    expect(update.$inc["currencyBalances.personal.USD"]).toBe(-1_010_000);
  });

  it("on guarded debit success, writes the bond holder and emits bond_purchase tx", async () => {
    db.collectionMocks["characters"]!.findOneAndUpdate.mockResolvedValue({
      _id: charId,
      currencyBalances: { personal: { USD: 0 }, savings: {}, campaign: 0 },
    });
    db.collectionMocks["bonds"]!.updateOne.mockResolvedValueOnce({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
    }).mockResolvedValueOnce({ acknowledged: true, matchedCount: 1, modifiedCount: 1 });

    const url = `http://test.local/api/bonds/${bondId.toString()}/buy`;
    const req = new Request(url, {
      method: "POST",
      body: JSON.stringify({ units: 1000 }),
      headers: { "content-type": "application/json" },
    });

    const { POST } = await import("../[bondId]/buy/route");
    const res = await POST(req, { params: Promise.resolve({ bondId: bondId.toString() }) });

    expect(res.status).toBe(200);

    const bondWrites = db.collectionMocks["bonds"]!.updateOne.mock.calls;
    const holderPush = bondWrites.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>).$push !== undefined
    );
    expect(holderPush).toBeDefined();
    const pushFilter = holderPush![0] as Record<string, unknown>;
    expect(pushFilter.publicFloat).toEqual({ $gte: 1000 });
    const pushDoc = (holderPush![1] as { $push: { holders: { units: number } } }).$push.holders;
    expect(pushDoc.units).toBe(1000);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTx)).toHaveBeenCalledTimes(1);
    const txArg = vi.mocked(emitTx).mock.calls[0][1];
    expect(txArg.type).toBe("bond_purchase");
    expect(txArg.amount).toBe(-1_010_000);
    expect(txArg.subjectType).toBe("character");
  });

  it("refunds the cash if the bond holder write throws after debit", async () => {
    db.collectionMocks["characters"]!.findOneAndUpdate.mockResolvedValue({
      _id: charId,
      currencyBalances: { personal: { USD: 0 }, savings: {}, campaign: 0 },
    });
    db.collectionMocks["bonds"]!.updateOne.mockResolvedValueOnce({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
    }).mockRejectedValueOnce(new Error("boom"));

    const url = `http://test.local/api/bonds/${bondId.toString()}/buy`;
    const req = new Request(url, {
      method: "POST",
      body: JSON.stringify({ units: 1000 }),
      headers: { "content-type": "application/json" },
    });

    const { POST } = await import("../[bondId]/buy/route");
    const res = await POST(req, { params: Promise.resolve({ bondId: bondId.toString() }) });

    expect(res.status).toBe(500);

    // Refund: a positive $inc on the same balance field on the characters collection.
    const refundCall = db.collectionMocks["characters"]!.updateOne.mock.calls.find(
      (c: unknown[]) =>
        ((c[1] as { $inc?: Record<string, number> }).$inc?.["currencyBalances.personal.USD"] ?? 0) >
        0
    );
    expect(refundCall).toBeDefined();
    const refundAmount = (refundCall![1] as { $inc: Record<string, number> }).$inc[
      "currencyBalances.personal.USD"
    ];
    expect(refundAmount).toBe(1_010_000);

    // No tx should be emitted on failure.
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTx)).not.toHaveBeenCalled();
  });
});
