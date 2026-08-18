import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ceoSelfAcquisitionWindow, assertCeoAcquisitionWithinCap } from "./ceoShareAcquisitionCap";

let db: MockDb;
const ceoId = new ObjectId();
const corp = { _id: new ObjectId(), totalShares: 1_000_000 } as never;

beforeEach(() => {
  db = createMockDb();
  db.collection("shareTradeHistory");
});

function historyReturns(rows: unknown[]) {
  db.collectionMocks["shareTradeHistory"]!.find = (() => ({ toArray: async () => rows })) as never;
}

describe("ceoSelfAcquisitionWindow", () => {
  it("returns full remaining when no acquisitions", async () => {
    historyReturns([]);
    const w = await ceoSelfAcquisitionWindow(db as never, corp, ceoId, "characterId", 200);
    expect(w.acquiredShares).toBe(0);
    expect(w.capShares).toBe(100_000); // floor(0.10 * 1,000,000)
    expect(w.remainingShares).toBe(100_000);
  });

  it("sums acquisition rows and computes the countdown", async () => {
    historyReturns([
      { shares: 40_000, turn: 150 },
      { shares: 25_000, turn: 130 },
    ]);
    const w = await ceoSelfAcquisitionWindow(db as never, corp, ceoId, "characterId", 200);
    expect(w.acquiredShares).toBe(65_000);
    expect(w.remainingShares).toBe(35_000);
    expect(w.oldestInWindowTurn).toBe(130);
    expect(w.freesUpInTurns).toBe(130 + 120 - 200); // = 50
  });
});

describe("assertCeoAcquisitionWithinCap", () => {
  const corpDoc = { _id: new ObjectId(), name: "TickerCo", totalShares: 1_000_000, ceoId } as never;

  beforeEach(() => {
    db.collection("shareOrders");
    db.collection("shareOffers");
    db.collectionMocks["shareOrders"]!.find = (() => ({ toArray: async () => [] })) as never;
    db.collectionMocks["shareOffers"]!.find = (() => ({ toArray: async () => [] })) as never;
  });

  it("returns null (no cap) for a non-CEO buyer", async () => {
    historyReturns([]);
    const res = await assertCeoAcquisitionWithinCap(
      db as never,
      corpDoc,
      new ObjectId(), // different buyer
      "characterId",
      999_999,
      200
    );
    expect(res).toBeNull();
  });

  it("rejects the CEO over the cap with a countdown message", async () => {
    historyReturns([{ shares: 95_000, turn: 130 }]);
    const res = await assertCeoAcquisitionWithinCap(
      db as never,
      corpDoc,
      ceoId,
      "characterId",
      20_000,
      200
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    expect(res!.error).toContain("10%");
    expect(res!.error).toContain("50 turns"); // 130 + 120 - 200
  });

  it("allows the CEO at exactly the cap boundary", async () => {
    historyReturns([{ shares: 90_000, turn: 130 }]);
    const res = await assertCeoAcquisitionWithinCap(
      db as never,
      corpDoc,
      ceoId,
      "characterId",
      10_000,
      200
    );
    expect(res).toBeNull();
  });

  it("counts open buy orders + offers toward the committed tally", async () => {
    historyReturns([{ shares: 50_000, turn: 130 }]);
    db.collectionMocks["shareOrders"]!.find = (() => ({
      toArray: async () => [{ sharesRemaining: 30_000 }],
    })) as never;
    db.collectionMocks["shareOffers"]!.find = (() => ({
      toArray: async () => [{ shares: 15_000 }],
    })) as never;
    // committed = 50k + 30k + 15k = 95k; +6k would exceed 100k cap
    const res = await assertCeoAcquisitionWithinCap(
      db as never,
      corpDoc,
      ceoId,
      "characterId",
      6_000,
      200
    );
    expect(res).not.toBeNull();
  });

  it("does not cap the CEO of a private corporation", async () => {
    historyReturns([]);
    const privateCorp = {
      _id: new ObjectId(),
      name: "PrivateCo",
      totalShares: 1_000_000,
      ceoId,
      isPrivate: true,
    } as never;
    const res = await assertCeoAcquisitionWithinCap(
      db as never,
      privateCorp,
      ceoId,
      "characterId",
      999_999,
      200
    );
    expect(res).toBeNull();
  });
});
