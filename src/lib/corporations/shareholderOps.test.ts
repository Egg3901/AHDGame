import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  // Pre-initialize the corporations collection so collectionMocks["corporations"] exists
  // before tests reference it directly to set up mock return values.
  db.collection("corporations");
  vi.clearAllMocks();
});

describe("creditShares (character, cost basis)", () => {
  it("sets avgCostPerShare on first push when pricePerShare is given", async () => {
    const corpId = new ObjectId();
    const charId = new ObjectId();

    db.collectionMocks["corporations"].updateOne
      .mockResolvedValueOnce({ matchedCount: 0 }) // inc misses
      .mockResolvedValueOnce({ matchedCount: 1 }); // push

    const { creditShares } = await import("./shareholderOps");
    await creditShares(db as any, corpId, charId, 100, undefined, { pricePerShare: 22.5 });

    const pushCall = db.collectionMocks["corporations"].updateOne.mock.calls.find(
      (c: any[]) => c[1].$push?.shareholders
    );
    expect(pushCall).toBeDefined();
    expect(pushCall![1].$push.shareholders.avgCostPerShare).toBe(22.5);
  });

  it("blends weighted average when adding to an existing character position", async () => {
    const corpId = new ObjectId();
    const charId = new ObjectId();

    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: corpId,
      shareholders: [{ characterId: charId, shares: 100, avgCostPerShare: 10 }],
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ matchedCount: 1 });

    const { creditShares } = await import("./shareholderOps");
    await creditShares(db as any, corpId, charId, 50, undefined, { pricePerShare: 16 });

    const setCall = db.collectionMocks["corporations"].updateOne.mock.calls.find(
      (c: any[]) => c[1].$set?.["shareholders.$.avgCostPerShare"] !== undefined
    );
    expect(setCall).toBeDefined();
    const avgSet = setCall![1].$set["shareholders.$.avgCostPerShare"] as number;
    expect(Math.round(avgSet * 1000) / 1000).toBeCloseTo(12, 2);
  });
});

describe("creditSharesToCorp", () => {
  it("increments shares on an existing corp entry", async () => {
    const targetCorpId = new ObjectId();
    const buyerCorpId = new ObjectId();
    const existingEntry = { corporationId: buyerCorpId, shares: 1000, avgCostPerShare: 10 };

    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [existingEntry],
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ matchedCount: 1 });

    const { creditSharesToCorp } = await import("./shareholderOps");
    await creditSharesToCorp(db as any, targetCorpId, buyerCorpId, 500, 12);

    expect(db.collectionMocks["corporations"].updateOne).toHaveBeenCalled();
  });

  it("pushes a new entry when corp has no existing position", async () => {
    const targetCorpId = new ObjectId();
    const buyerCorpId = new ObjectId();

    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [],
    });
    db.collectionMocks["corporations"].updateOne
      .mockResolvedValueOnce({ matchedCount: 0 }) // positional update misses
      .mockResolvedValueOnce({ matchedCount: 1 }); // push succeeds

    const { creditSharesToCorp } = await import("./shareholderOps");
    await creditSharesToCorp(db as any, targetCorpId, buyerCorpId, 500, 12);

    // Second updateOne should $push a new entry
    const secondCall = db.collectionMocks["corporations"].updateOne.mock.calls[1];
    expect(secondCall[1].$push).toBeDefined();
  });

  it("computes weighted average cost correctly", async () => {
    const targetCorpId = new ObjectId();
    const buyerCorpId = new ObjectId();

    // Existing: 1000 shares @ $10 avg. Buying 500 more @ $12.
    // New avg = (1000*10 + 500*12) / 1500 = 16000/1500 ≈ 10.667
    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [{ corporationId: buyerCorpId, shares: 1000, avgCostPerShare: 10 }],
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ matchedCount: 1 });

    const { creditSharesToCorp } = await import("./shareholderOps");
    await creditSharesToCorp(db as any, targetCorpId, buyerCorpId, 500, 12);

    const setCall = db.collectionMocks["corporations"].updateOne.mock.calls.find(
      (c: any[]) => c[1].$set?.["shareholders.$.avgCostPerShare"] !== undefined
    );
    expect(setCall).toBeDefined();
    if (!setCall) throw new Error("Expected updateOne to be called with $set.avgCostPerShare");
    const avgSet = setCall[1].$set["shareholders.$.avgCostPerShare"] as number;
    expect(Math.round(avgSet * 1000) / 1000).toBeCloseTo(10.667, 2);
  });
});

describe("debitSharesFromCorp", () => {
  it("decrements shares from a corp shareholder entry", async () => {
    const targetCorpId = new ObjectId();
    const holderCorpId = new ObjectId();

    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [{ corporationId: holderCorpId, shares: 500 }],
    });

    const { debitSharesFromCorp } = await import("./shareholderOps");
    const remaining = await debitSharesFromCorp(db as any, targetCorpId, holderCorpId, 200);

    expect(remaining).toBe(500);
  });

  it("removes entry when shares reach zero", async () => {
    const targetCorpId = new ObjectId();
    const holderCorpId = new ObjectId();

    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [{ corporationId: holderCorpId, shares: 0 }],
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { debitSharesFromCorp } = await import("./shareholderOps");
    const remaining = await debitSharesFromCorp(db as any, targetCorpId, holderCorpId, 200);

    expect(remaining).toBe(0);
    expect(db.collectionMocks["corporations"].updateOne).toHaveBeenCalledWith(
      { _id: targetCorpId },
      expect.objectContaining({ $pull: expect.anything() })
    );
  });

  it("propagates the Mongo session to the primary findOneAndUpdate", async () => {
    const targetCorpId = new ObjectId();
    const holderCorpId = new ObjectId();
    const session = { sentinel: "sess" } as any;

    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [{ corporationId: holderCorpId, shares: 500 }],
    });

    const { debitSharesFromCorp } = await import("./shareholderOps");
    await debitSharesFromCorp(db as any, targetCorpId, holderCorpId, 200, undefined, {
      requireSufficient: true,
      session,
    });

    const call = db.collectionMocks["corporations"].findOneAndUpdate.mock.calls[0];
    expect(call[2]).toMatchObject({ returnDocument: "after", session });
  });

  it("passes the session to the cleanup $pull when the entry is removed", async () => {
    const targetCorpId = new ObjectId();
    const holderCorpId = new ObjectId();
    const session = { sentinel: "sess" } as any;

    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [{ corporationId: holderCorpId, shares: 0 }],
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { debitSharesFromCorp } = await import("./shareholderOps");
    await debitSharesFromCorp(db as any, targetCorpId, holderCorpId, 200, undefined, { session });

    const pullCall = db.collectionMocks["corporations"].updateOne.mock.calls.find(
      (c: any[]) => c[1].$pull
    );
    expect(pullCall).toBeDefined();
    expect(pullCall![2]).toMatchObject({ session });
  });
});

describe("debitSharesFromImperial", () => {
  it("propagates the Mongo session to the primary findOneAndUpdate", async () => {
    const targetCorpId = new ObjectId();
    const imperialCharacterId = new ObjectId();
    const session = { sentinel: "sess" } as any;

    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [{ imperialCharacterId, shares: 800 }],
    });

    const { debitSharesFromImperial } = await import("./shareholderOps");
    await debitSharesFromImperial(db as any, targetCorpId, imperialCharacterId, 200, undefined, {
      requireSufficient: true,
      session,
    });

    const call = db.collectionMocks["corporations"].findOneAndUpdate.mock.calls[0];
    expect(call[2]).toMatchObject({ returnDocument: "after", session });
  });

  it("passes the session to the cleanup $pull when the entry is removed", async () => {
    const targetCorpId = new ObjectId();
    const imperialCharacterId = new ObjectId();
    const session = { sentinel: "sess" } as any;

    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [{ imperialCharacterId, shares: 0 }],
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { debitSharesFromImperial } = await import("./shareholderOps");
    await debitSharesFromImperial(db as any, targetCorpId, imperialCharacterId, 200, undefined, {
      session,
    });

    const pullCall = db.collectionMocks["corporations"].updateOne.mock.calls.find(
      (c: any[]) => c[1].$pull
    );
    expect(pullCall).toBeDefined();
    expect(pullCall![2]).toMatchObject({ session });
  });
});

describe("debitShares", () => {
  it("forwards $unset fields to the corporation write", async () => {
    const corpId = new ObjectId();
    const charId = new ObjectId();

    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: corpId,
      shareholders: [{ characterId: charId, shares: 0 }],
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { debitShares } = await import("./shareholderOps");
    const remaining = await debitShares(
      db as any,
      corpId,
      charId,
      100,
      {
        $set: { ceoVacant: true },
        $unset: { ceoId: "", userId: "", pendingCeoCharacterId: "" },
      },
      { requireSufficient: true }
    );

    expect(remaining).toBe(0);
    expect(db.collectionMocks["corporations"].findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: { ceoVacant: true },
        $unset: { ceoId: "", userId: "", pendingCeoCharacterId: "" },
      }),
      { returnDocument: "after" }
    );
  });

  it("passes the session to the cleanup $pull when the entry is removed", async () => {
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const session = { sentinel: "sess" } as any;

    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: corpId,
      shareholders: [{ characterId: charId, shares: 0 }],
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { debitShares } = await import("./shareholderOps");
    await debitShares(db as any, corpId, charId, 100, undefined, { session });

    const pullCall = db.collectionMocks["corporations"].updateOne.mock.calls.find(
      (c: any[]) => c[1].$pull
    );
    expect(pullCall).toBeDefined();
    expect(pullCall![2]).toMatchObject({ session });
  });
});

describe("creditSharesToFund", () => {
  it("increments shares on an existing fund entry", async () => {
    const targetCorpId = new ObjectId();
    const fundId = new ObjectId();

    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [{ fundId, shares: 1000, avgCostPerShare: 10 }],
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ matchedCount: 1 });

    const { creditSharesToFund } = await import("./shareholderOps");
    await creditSharesToFund(db as any, targetCorpId, fundId, 250, 14);

    const updateCall = db.collectionMocks["corporations"].updateOne.mock.calls[0];
    expect(updateCall[0]).toMatchObject({ _id: targetCorpId, "shareholders.fundId": fundId });
    expect(updateCall[1].$inc["shareholders.$.shares"]).toBe(250);
  });

  it("pushes a fund entry when no position exists", async () => {
    const targetCorpId = new ObjectId();
    const fundId = new ObjectId();

    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [],
    });
    db.collectionMocks["corporations"].updateOne
      .mockResolvedValueOnce({ matchedCount: 0 })
      .mockResolvedValueOnce({ matchedCount: 1 });

    const { creditSharesToFund } = await import("./shareholderOps");
    await creditSharesToFund(db as any, targetCorpId, fundId, 500, 12.5);

    const pushCall = db.collectionMocks["corporations"].updateOne.mock.calls[1];
    expect(pushCall[1].$push.shareholders).toMatchObject({
      fundId,
      shares: 500,
      avgCostPerShare: 12.5,
    });
  });

  it("returns false instead of throwing when a guarded public-float buy loses the race", async () => {
    const targetCorpId = new ObjectId();
    const fundId = new ObjectId();

    db.collectionMocks["corporations"].findOne
      .mockResolvedValueOnce({ _id: targetCorpId, shareholders: [] })
      .mockResolvedValueOnce({ _id: targetCorpId, shareholders: [] });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ matchedCount: 0 });

    const { creditSharesToFund } = await import("./shareholderOps");
    const credited = await creditSharesToFund(
      db as any,
      targetCorpId,
      fundId,
      500,
      12.5,
      undefined,
      {
        guardFilter: { publicFloat: { $gte: 500 } },
      }
    );

    expect(credited).toBe(false);
  });
});

describe("debitSharesFromFund", () => {
  it("decrements a fund shareholder entry", async () => {
    const targetCorpId = new ObjectId();
    const fundId = new ObjectId();

    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [{ fundId, shares: 700 }],
    });

    const { debitSharesFromFund } = await import("./shareholderOps");
    const remaining = await debitSharesFromFund(db as any, targetCorpId, fundId, 300);

    expect(remaining).toBe(700);
    const call = db.collectionMocks["corporations"].findOneAndUpdate.mock.calls[0];
    expect(call[0]).toMatchObject({ _id: targetCorpId, "shareholders.fundId": fundId });
    expect(call[1].$inc["shareholders.$.shares"]).toBe(-300);
  });

  it("removes a fund entry when shares reach zero", async () => {
    const targetCorpId = new ObjectId();
    const fundId = new ObjectId();

    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [{ fundId, shares: 0 }],
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { debitSharesFromFund } = await import("./shareholderOps");
    const remaining = await debitSharesFromFund(db as any, targetCorpId, fundId, 300);

    expect(remaining).toBe(0);
    expect(db.collectionMocks["corporations"].updateOne).toHaveBeenCalledWith(
      { _id: targetCorpId },
      expect.objectContaining({ $pull: { shareholders: { fundId } } })
    );
  });

  // Regression: the primary debit must run inside the caller's transaction.
  // When it ran outside the session, a `withTransaction` retry re-applied the
  // already-committed debit, double-debiting the seller fund in cross-fund
  // rebalancing and destroying shares from the cap table (Corp 117, -3,351).
  it("propagates the Mongo session to the primary findOneAndUpdate", async () => {
    const targetCorpId = new ObjectId();
    const fundId = new ObjectId();
    const session = { sentinel: "sess" } as any;

    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [{ fundId, shares: 700 }],
    });

    const { debitSharesFromFund } = await import("./shareholderOps");
    await debitSharesFromFund(db as any, targetCorpId, fundId, 300, undefined, {
      requireSufficient: true,
      session,
    });

    const call = db.collectionMocks["corporations"].findOneAndUpdate.mock.calls[0];
    expect(call[2]).toMatchObject({ returnDocument: "after", session });
  });
});

describe("creditSharesToNpp", () => {
  it("increments shares on an existing NPP entry", async () => {
    const targetCorpId = new ObjectId();
    const nppId = new ObjectId();

    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [{ nppId, shares: 1000, avgCostPerShare: 10 }],
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ matchedCount: 1 });

    const { creditSharesToNpp } = await import("./shareholderOps");
    await creditSharesToNpp(db as any, targetCorpId, nppId, 250, 14);

    const updateCall = db.collectionMocks["corporations"].updateOne.mock.calls[0];
    expect(updateCall[0]).toMatchObject({ _id: targetCorpId, "shareholders.nppId": nppId });
    expect(updateCall[1].$inc["shareholders.$.shares"]).toBe(250);
  });

  it("pushes an NPP entry when no position exists", async () => {
    const targetCorpId = new ObjectId();
    const nppId = new ObjectId();

    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [],
    });
    db.collectionMocks["corporations"].updateOne
      .mockResolvedValueOnce({ matchedCount: 0 })
      .mockResolvedValueOnce({ matchedCount: 1 });

    const { creditSharesToNpp } = await import("./shareholderOps");
    await creditSharesToNpp(db as any, targetCorpId, nppId, 500, 12.5);

    const pushCall = db.collectionMocks["corporations"].updateOne.mock.calls[1];
    expect(pushCall[1].$push.shareholders).toMatchObject({
      nppId,
      shares: 500,
      avgCostPerShare: 12.5,
    });
  });

  it("returns false instead of throwing when a guarded public-float buy loses the race", async () => {
    const targetCorpId = new ObjectId();
    const nppId = new ObjectId();

    db.collectionMocks["corporations"].findOne
      .mockResolvedValueOnce({ _id: targetCorpId, shareholders: [] })
      .mockResolvedValueOnce({ _id: targetCorpId, shareholders: [] });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ matchedCount: 0 });

    const { creditSharesToNpp } = await import("./shareholderOps");
    const credited = await creditSharesToNpp(db as any, targetCorpId, nppId, 500, 12.5, undefined, {
      guardFilter: { publicFloat: { $gte: 500 } },
    });

    expect(credited).toBe(false);
  });
});

describe("debitSharesFromNpp", () => {
  it("decrements an NPP shareholder entry", async () => {
    const targetCorpId = new ObjectId();
    const nppId = new ObjectId();

    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [{ nppId, shares: 700 }],
    });

    const { debitSharesFromNpp } = await import("./shareholderOps");
    const remaining = await debitSharesFromNpp(db as any, targetCorpId, nppId, 300);

    expect(remaining).toBe(700);
    const call = db.collectionMocks["corporations"].findOneAndUpdate.mock.calls[0];
    expect(call[0]).toMatchObject({ _id: targetCorpId, "shareholders.nppId": nppId });
    expect(call[1].$inc["shareholders.$.shares"]).toBe(-300);
  });

  it("removes an NPP entry when shares reach zero", async () => {
    const targetCorpId = new ObjectId();
    const nppId = new ObjectId();

    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: targetCorpId,
      shareholders: [{ nppId, shares: 0 }],
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { debitSharesFromNpp } = await import("./shareholderOps");
    const remaining = await debitSharesFromNpp(db as any, targetCorpId, nppId, 300);

    expect(remaining).toBe(0);
    expect(db.collectionMocks["corporations"].updateOne).toHaveBeenCalledWith(
      { _id: targetCorpId },
      expect.objectContaining({ $pull: { shareholders: { nppId } } })
    );
  });
});
