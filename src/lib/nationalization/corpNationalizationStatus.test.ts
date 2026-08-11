import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Corporation } from "@/lib/db/types";

function cursor<T>(rows: T[]) {
  return { toArray: vi.fn().mockResolvedValue(rows), project: vi.fn().mockReturnThis() };
}

describe("buildCorpNationalizationStatus", () => {
  let db: MockDb;
  const corpId = new ObjectId();
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of [
      "corporateSectors",
      "pendingNationalizations",
      "nationalizationAuctions",
      "bills",
    ])
      db.collection(n);
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor([]));
    db.collectionMocks.pendingNationalizations.find.mockReturnValue(cursor([]));
    db.collectionMocks.bills.find.mockReturnValue(cursor([]));
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue(null);
  });

  it("reports no status for an ordinary corp", async () => {
    const corp = { _id: corpId, countryId: "US" } as unknown as Corporation;
    const { buildCorpNationalizationStatus } = await import("./corpNationalizationStatus");
    const s = await buildCorpNationalizationStatus(db as unknown as Db, corp, 100);
    expect(s.pendingTaking).toBeNull();
    expect(s.isSpunOut).toBe(false);
    expect(s.auctionOpen).toBe(false);
    expect(s.hasStatus).toBe(false);
  });

  it("surfaces a pending whole-corp taking with countdown + curable subset", async () => {
    db.collectionMocks.pendingNationalizations.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          targetCorporationId: corpId,
          tier: "fair",
          method: "executive",
          triggers: ["strategic", "supermajority"],
          noticeDeadlineTurn: 130,
          status: "pending",
        },
      ])
    );
    const corp = { _id: corpId, countryId: "US" } as unknown as Corporation;
    const { buildCorpNationalizationStatus } = await import("./corpNationalizationStatus");
    const s = await buildCorpNationalizationStatus(db as unknown as Db, corp, 100);
    expect(s.pendingTaking?.turnsLeft).toBe(30);
    expect(s.pendingTaking?.curableTriggers).toEqual(["strategic"]);
    expect(s.hasStatus).toBe(true);
  });

  it("exposes no curable triggers for a legislative taking (a passed bill is not curable)", async () => {
    db.collectionMocks.pendingNationalizations.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          targetCorporationId: corpId,
          tier: "fair",
          method: "legislative",
          triggers: ["strategic", "monopoly"],
          noticeDeadlineTurn: 130,
          status: "pending",
        },
      ])
    );
    const corp = { _id: corpId, countryId: "US" } as unknown as Corporation;
    const { buildCorpNationalizationStatus } = await import("./corpNationalizationStatus");
    const s = await buildCorpNationalizationStatus(db as unknown as Db, corp, 100);
    expect(s.pendingTaking?.method).toBe("legislative");
    expect(s.pendingTaking?.curableTriggers).toEqual([]);
  });

  it("surfaces open-auction detail for the corp-profile bid CTA", async () => {
    const auctionId = new ObjectId();
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue({
      _id: auctionId,
      corporationId: corpId,
      countryId: "CN",
      reservePrice: 100_000_000,
      reserveCurrency: "CNY",
      closesAtTurn: 51,
      bids: [{ characterId: new ObjectId(), amount: 120_000_000 }],
    });
    const corp = { _id: corpId, countryId: "CN" } as unknown as Corporation;
    const { buildCorpNationalizationStatus } = await import("./corpNationalizationStatus");
    const s = await buildCorpNationalizationStatus(db as unknown as Db, corp, 3);
    expect(s.auctionOpen).toBe(true);
    expect(s.auction).toEqual({
      auctionId: String(auctionId),
      countryId: "CN",
      reservePrice: 100_000_000,
      currency: "CNY",
      highestBid: 120_000_000,
      bidCount: 1,
      turnsLeft: 48,
    });
    expect(s.hasStatus).toBe(true);
  });

  it("surfaces an active nationalization bill in voting against the corp", async () => {
    const billId = new ObjectId();
    db.collectionMocks.bills.find.mockReturnValue(
      cursor([
        {
          _id: billId,
          status: "active",
          countryId: "CN",
          title: "Nationalize Acme",
          provisions: [{ type: "nationalize", targetCorporationId: corpId }],
        },
      ])
    );
    const corp = { _id: corpId, countryId: "CN" } as unknown as Corporation;
    const { buildCorpNationalizationStatus } = await import("./corpNationalizationStatus");
    const s = await buildCorpNationalizationStatus(db as unknown as Db, corp, 100);
    expect(s.billsInVoting).toEqual([
      { billId: String(billId), title: "Nationalize Acme", whole: true, sectorCount: 0 },
    ]);
    expect(s.hasStatus).toBe(true);
  });

  it("flags a spun-out corp with a golden share", async () => {
    const corp = {
      _id: corpId,
      countryId: "US",
      privatizedAtTurn: 90,
      goldenSharePercent: 0.2,
    } as unknown as Corporation;
    const { buildCorpNationalizationStatus } = await import("./corpNationalizationStatus");
    const s = await buildCorpNationalizationStatus(db as unknown as Db, corp, 100);
    expect(s.isSpunOut).toBe(true);
    expect(s.goldenSharePercent).toBe(0.2);
    expect(s.hasStatus).toBe(true);
  });
});
