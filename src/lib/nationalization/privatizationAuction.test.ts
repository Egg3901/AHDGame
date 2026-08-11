import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/financialTxLog/atomicCashGuard", () => ({
  atomicallyDebitCharacterCash: vi.fn().mockResolvedValue({ ok: true, newBalance: 0 }),
  refundCharacterCash: vi.fn().mockResolvedValue(undefined),
  atomicallyDebitCorpLiquidCapital: vi.fn().mockResolvedValue({ ok: true, newBalance: 0 }),
  refundCorpLiquidCapital: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/corporations/cleanupShareMarketActivity", () => ({
  cleanupShareMarketActivityForCorporations: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/financialTxLog/stampDeleted", () => ({
  stampSubjectDeleted: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./nationalCorporation", () => ({
  resolveNationalCorporationForSector: vi.fn(),
  isStateOwned: (c: { countryOwnerId?: string; ownershipState?: string }) =>
    !!c.countryOwnerId || c.ownershipState === "stateOwned",
}));
vi.mock("./treasury", () => ({ creditTreasuryProceeds: vi.fn().mockResolvedValue(0) }));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineCorpPrivatized: vi.fn().mockReturnValue("headline"),
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./consequences/apply", () => ({
  applyPrivatizationConsequences: vi
    .fn()
    .mockResolvedValue({ confidenceBefore: 70, confidenceAfter: 73, legitimacyDelta: 1 }),
}));
vi.mock("./privatizationNotifications", () => ({
  notifyCountryResidents: vi.fn().mockResolvedValue(undefined),
}));

const auctionId = new ObjectId();
const charId = new ObjectId();

function baseAuction(overrides: Record<string, unknown> = {}) {
  return {
    _id: auctionId,
    corporationId: new ObjectId(),
    countryId: "US",
    primaryNationalCorporationId: new ObjectId(),
    openedAtTurn: 0,
    closesAtTurn: 100,
    reservePrice: 1000,
    reserveCurrency: "USD",
    goldenSharePercent: 0.1,
    status: "open",
    bids: [],
    ...overrides,
  };
}

describe("placeAuctionBid", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("nationalizationAuctions");
    db.collection("corporations");
    db.collection("characters");
    // The acting character is a resident of the auction's country (US) by default,
    // so the residency gate passes for the existing bid-mechanics cases.
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      countryId: "US",
      homeState: "CA",
    });
  });

  it("rejects a bid below the reserve", async () => {
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue(baseAuction());
    const { placeAuctionBid } = await import("./privatizationAuction");
    await expect(
      placeAuctionBid(db as unknown as Db, {
        auctionId,
        characterId: charId,
        amount: 500,
        turn: 10,
      })
    ).rejects.toThrow(/reserve/i);
  });

  it("escrows a first valid character bid and records it", async () => {
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue(baseAuction());
    const { placeAuctionBid } = await import("./privatizationAuction");
    const { atomicallyDebitCharacterCash } = await import("@/lib/financialTxLog/atomicCashGuard");
    await placeAuctionBid(db as unknown as Db, {
      auctionId,
      characterId: charId,
      amount: 1500,
      turn: 10,
    });
    expect(vi.mocked(atomicallyDebitCharacterCash)).toHaveBeenCalledWith(
      db,
      charId,
      "USD",
      1500,
      false
    );
    const upd = db.collectionMocks.nationalizationAuctions.updateOne.mock.calls[0];
    expect(upd[1].$set.bids).toHaveLength(1);
    expect(upd[1].$set.bids[0]).toMatchObject({ characterId: charId, amount: 1500 });
    // No prior history → seeded via $set; only this bid present.
    expect(upd[1].$set.bidHistory).toHaveLength(1);
    expect(upd[1].$set.bidHistory[0]).toMatchObject({
      characterId: charId,
      amount: 1500,
      placedAtTurn: 10,
    });
  });

  it("seeds bid history from existing standing bids on the first append (legacy auction)", async () => {
    const other = new ObjectId();
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue(
      baseAuction({
        bids: [{ characterId: other, amount: 1200, escrowCurrency: "USD", placedAtTurn: 3 }],
        // no bidHistory
      })
    );
    const { placeAuctionBid } = await import("./privatizationAuction");
    await placeAuctionBid(db as unknown as Db, {
      auctionId,
      characterId: charId,
      amount: 1500,
      turn: 10,
    });
    const upd = db.collectionMocks.nationalizationAuctions.updateOne.mock.calls[0];
    // Seeded with the prior standing bid + the new one (chronological).
    expect(upd[1].$set.bidHistory).toHaveLength(2);
    expect(upd[1].$set.bidHistory[0]).toMatchObject({ characterId: other, amount: 1200 });
    expect(upd[1].$set.bidHistory[1]).toMatchObject({ characterId: charId, amount: 1500 });
    expect(upd[1].$push).toBeUndefined();
  });

  it("appends to an existing bid history via $push", async () => {
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue(
      baseAuction({
        bidHistory: [{ characterId: new ObjectId(), amount: 1100, placedAtTurn: 2 }],
      })
    );
    const { placeAuctionBid } = await import("./privatizationAuction");
    await placeAuctionBid(db as unknown as Db, {
      auctionId,
      characterId: charId,
      amount: 1500,
      turn: 10,
    });
    const upd = db.collectionMocks.nationalizationAuctions.updateOne.mock.calls[0];
    expect(upd[1].$push.bidHistory).toMatchObject({ characterId: charId, amount: 1500 });
    expect(upd[1].$set.bidHistory).toBeUndefined();
  });

  it("on a self-raise, debits only the delta and keeps the standing escrow (no self-refund)", async () => {
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue(
      baseAuction({
        bids: [{ characterId: charId, amount: 1500, escrowCurrency: "USD", placedAtTurn: 5 }],
        bidHistory: [{ characterId: charId, amount: 1500, placedAtTurn: 5 }],
      })
    );
    const { placeAuctionBid } = await import("./privatizationAuction");
    const { atomicallyDebitCharacterCash, refundCharacterCash } =
      await import("@/lib/financialTxLog/atomicCashGuard");
    await placeAuctionBid(db as unknown as Db, {
      auctionId,
      characterId: charId,
      amount: 2000,
      turn: 11,
    });
    // Only the 500 delta is debited; the bidder's existing 1500 escrow stays put.
    expect(vi.mocked(atomicallyDebitCharacterCash)).toHaveBeenCalledWith(
      db,
      charId,
      "USD",
      500,
      false
    );
    expect(vi.mocked(refundCharacterCash)).not.toHaveBeenCalled();
    const upd = db.collectionMocks.nationalizationAuctions.updateOne.mock.calls[0];
    expect(upd[1].$set.bids).toHaveLength(1);
    expect(upd[1].$set.bids[0].amount).toBe(2000);
  });

  it("on an outbid, refunds the previous leader and escrows only the new bid", async () => {
    const prevLeader = new ObjectId();
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue(
      baseAuction({
        bids: [{ characterId: prevLeader, amount: 1500, escrowCurrency: "USD", placedAtTurn: 5 }],
        bidHistory: [{ characterId: prevLeader, amount: 1500, placedAtTurn: 5 }],
      })
    );
    const { placeAuctionBid } = await import("./privatizationAuction");
    const { atomicallyDebitCharacterCash, refundCharacterCash } =
      await import("@/lib/financialTxLog/atomicCashGuard");
    await placeAuctionBid(db as unknown as Db, {
      auctionId,
      characterId: charId, // a different bidder
      amount: 2000,
      turn: 11,
    });
    // New bidder posts the full amount; the outbid leader is refunded their escrow.
    expect(vi.mocked(atomicallyDebitCharacterCash)).toHaveBeenCalledWith(
      db,
      charId,
      "USD",
      2000,
      false
    );
    expect(vi.mocked(refundCharacterCash)).toHaveBeenCalledWith(db, prevLeader, "USD", 1500, false);
    const upd = db.collectionMocks.nationalizationAuctions.updateOne.mock.calls[0];
    expect(upd[1].$set.bids).toHaveLength(1);
    expect(upd[1].$set.bids[0]).toMatchObject({ characterId: charId, amount: 2000 });
  });

  it("rolls back its own debit and refunds NO one else when it loses the leadership CAS", async () => {
    // The concurrency fix: the `bids:[newBid]` write is gated on the exact bids
    // array we read. If a racer flipped the standing bid first, our updateOne
    // matches nothing (modifiedCount 0). We must undo our own debit and, crucially,
    // NOT refund the displaced leader (the winner already did, or will) — the old
    // bug double-refunded that leader and burned the losing racer's escrow.
    const prevLeader = new ObjectId();
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue(
      baseAuction({
        bids: [{ characterId: prevLeader, amount: 1500, escrowCurrency: "USD", placedAtTurn: 5 }],
        bidHistory: [{ characterId: prevLeader, amount: 1500, placedAtTurn: 5 }],
      })
    );
    // Simulate losing the race: the CAS write matches nothing.
    db.collectionMocks.nationalizationAuctions.updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });
    const { placeAuctionBid } = await import("./privatizationAuction");
    const { refundCharacterCash } = await import("@/lib/financialTxLog/atomicCashGuard");
    await expect(
      placeAuctionBid(db as unknown as Db, {
        auctionId,
        characterId: charId,
        amount: 2000,
        turn: 11,
      })
    ).rejects.toThrow(/another bid/i);
    // Exactly one refund: our own debit back to us. The displaced leader is NOT
    // refunded on this path.
    expect(vi.mocked(refundCharacterCash)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(refundCharacterCash)).toHaveBeenCalledWith(db, charId, "USD", 2000, false);
  });

  it("rejects a bid that does not exceed the current highest", async () => {
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue(
      baseAuction({
        bids: [
          { characterId: new ObjectId(), amount: 2000, escrowCurrency: "USD", placedAtTurn: 5 },
        ],
      })
    );
    const { placeAuctionBid } = await import("./privatizationAuction");
    await expect(
      placeAuctionBid(db as unknown as Db, {
        auctionId,
        characterId: charId,
        amount: 1800,
        turn: 10,
      })
    ).rejects.toThrow(/highest/i);
  });

  it("rejects a personal bid from a non-resident of the auction's country", async () => {
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue(baseAuction());
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      countryId: "UK", // auction is US
      homeState: "LDN",
    });
    const { placeAuctionBid } = await import("./privatizationAuction");
    await expect(
      placeAuctionBid(db as unknown as Db, {
        auctionId,
        characterId: charId,
        amount: 1500,
        turn: 10,
      })
    ).rejects.toThrow(/resident/i);
  });

  it("rejects a corp bid when the acting CEO is a non-resident", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue(baseAuction());
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      countryId: "UK", // auction is US
      homeState: "LDN",
    });
    const { placeAuctionBid } = await import("./privatizationAuction");
    await expect(
      placeAuctionBid(db as unknown as Db, {
        auctionId,
        characterId: charId,
        asCorporationId: corpId,
        amount: 1500,
        turn: 10,
      })
    ).rejects.toThrow(/resident/i);
  });

  it("escrows a corp bid from liquidCapital when the CEO bids in matching currency", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue(baseAuction());
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      ceoId: charId,
      ceoVacant: false,
      liquidCurrencyCode: "USD",
    });
    const { placeAuctionBid } = await import("./privatizationAuction");
    const { atomicallyDebitCorpLiquidCapital } =
      await import("@/lib/financialTxLog/atomicCashGuard");
    await placeAuctionBid(db as unknown as Db, {
      auctionId,
      characterId: charId,
      asCorporationId: corpId,
      amount: 1500,
      turn: 10,
    });
    expect(vi.mocked(atomicallyDebitCorpLiquidCapital)).toHaveBeenCalledWith(db, corpId, 1500);
    const upd = db.collectionMocks.nationalizationAuctions.updateOne.mock.calls[0];
    expect(upd[1].$set.bids[0]).toMatchObject({ corporationId: corpId, amount: 1500 });
  });

  it("rejects a corp bid from a non-CEO", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue(baseAuction());
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      ceoId: new ObjectId(), // someone else
      ceoVacant: false,
      liquidCurrencyCode: "USD",
    });
    const { placeAuctionBid } = await import("./privatizationAuction");
    await expect(
      placeAuctionBid(db as unknown as Db, {
        auctionId,
        characterId: charId,
        asCorporationId: corpId,
        amount: 1500,
        turn: 10,
      })
    ).rejects.toThrow(/CEO/i);
  });

  it("rejects a corp bid in a mismatched currency", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.nationalizationAuctions.findOne.mockResolvedValue(baseAuction());
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      ceoId: charId,
      ceoVacant: false,
      liquidCurrencyCode: "JPY",
    });
    const { placeAuctionBid } = await import("./privatizationAuction");
    await expect(
      placeAuctionBid(db as unknown as Db, {
        auctionId,
        characterId: charId,
        asCorporationId: corpId,
        amount: 1500,
        turn: 10,
      })
    ).rejects.toThrow(/currency/i);
  });
});

describe("reabsorbSpunOutCorp", () => {
  let db: MockDb;
  const primaryId = new ObjectId();
  const shellId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
  });

  it("moves sectors back, returns residual cash, dissolves the shell", async () => {
    const cursor = {
      toArray: vi.fn().mockResolvedValue([
        { _id: new ObjectId(), corporationId: shellId, countryId: "US", sectorType: "energy" },
        { _id: new ObjectId(), corporationId: shellId, countryId: "US", sectorType: "energy" },
      ]),
      sort: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    };
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor);
    const { resolveNationalCorporationForSector } = await import("./nationalCorporation");
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValue({ _id: primaryId } as never);

    const { reabsorbSpunOutCorp } = await import("./privatizationAuction");
    await reabsorbSpunOutCorp(
      db as unknown as Db,
      { _id: shellId, countryId: "US", liquidCapital: 500, sequentialId: 7 } as never,
      primaryId,
      42
    );

    // Both energy sectors routed back to the primary, absorbedAtTurn re-stamped.
    const upd = db.collectionMocks.corporateSectors.updateMany.mock.calls[0];
    expect(upd[1].$set.corporationId).toEqual(primaryId);
    expect(upd[1].$set.absorbedAtTurn).toBe(42);
    // Residual cash → primary.
    const corpUpd = db.collectionMocks.corporations.updateOne.mock.calls.find(
      (c) => c[1].$inc?.liquidCapital === 500
    );
    expect(corpUpd).toBeDefined();
    // Shell dissolved.
    expect(db.collectionMocks.corporations.deleteOne).toHaveBeenCalledWith({ _id: shellId });
  });
});

describe("resolveNationalizationAuction", () => {
  let db: MockDb;
  const shellId = new ObjectId();
  const primaryId = new ObjectId();
  const winnerId = new ObjectId();
  const loserId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("nationalizationAuctions");
    db.collection("corporations");
    db.collection("characters");
    db.collection("corporateSectors");
    db.collectionMocks.nationalizationAuctions.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("sold: refunds losers, credits the treasury, transfers ownership + CEO to the winner", async () => {
    const auction = baseAuction({
      corporationId: shellId,
      primaryNationalCorporationId: primaryId,
      goldenSharePercent: 0.1,
      bids: [
        { characterId: winnerId, amount: 5000, escrowCurrency: "USD", placedAtTurn: 3 },
        { characterId: loserId, amount: 3000, escrowCurrency: "USD", placedAtTurn: 2 },
      ],
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: shellId,
      name: "Shell Co",
      totalShares: 10_000_000,
      sequentialId: 9,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: winnerId,
      userId: new ObjectId(),
      homeState: "CA",
    });

    const { resolveNationalizationAuction } = await import("./privatizationAuction");
    const { creditTreasuryProceeds } = await import("./treasury");
    const { refundCharacterCash } = await import("@/lib/financialTxLog/atomicCashGuard");

    const result = await resolveNationalizationAuction(db as unknown as Db, auction as never, 50);

    expect(result).toBe("sold");
    expect(vi.mocked(creditTreasuryProceeds)).toHaveBeenCalledWith(
      db,
      "US",
      5000,
      expect.any(Date)
    );
    // Loser refunded; winner not.
    expect(vi.mocked(refundCharacterCash)).toHaveBeenCalledWith(db, loserId, "USD", 3000, false);
    expect(vi.mocked(refundCharacterCash)).not.toHaveBeenCalledWith(
      db,
      winnerId,
      "USD",
      5000,
      false
    );
    // Ownership transferred: golden block (1M) to primary + sale block (9M) to winner; CEO set.
    const upd = db.collectionMocks.corporations.updateOne.mock.calls.find(
      (c) => c[1].$set?.shareholders
    );
    expect(upd![1].$set.shareholders).toEqual([
      { corporationId: primaryId, shares: 1_000_000 },
      { characterId: winnerId, shares: 9_000_000 },
    ]);
    expect(upd![1].$set.ceoId).toEqual(winnerId);
    expect(upd![1].$set.ceoVacant).toBe(false);
    // A state shell may carry ceoType:"npp"; seating a human must reset it or the
    // corp page looks the CEO up in `npps` and renders "CEO Vacant".
    expect(upd![1].$set.ceoType).toBe("character");
    expect(upd![1].$set.suspended).toBe(false);
    expect(upd![1].$set.privatizedAtTurn).toBe(50);
    // HQ relocates to the winning character's home region.
    expect(upd![1].$set.headquartersState).toBe("CA");

    // Sale completes the privatization → consequences fire.
    const { applyPrivatizationConsequences } = await import("./consequences/apply");
    expect(vi.mocked(applyPrivatizationConsequences)).toHaveBeenCalledWith(db, {
      countryId: "US",
      turn: 50,
    });

    // Sale records a privatization row on the public State Ownership Register.
    const led = db.collectionMocks.nationalizationLedger.insertOne.mock.calls[0][0];
    expect(led.kind).toBe("privatize_auction");
    expect(led.countryId).toBe("US");
    expect(led.nationalCorporationId).toEqual(primaryId);
    expect(led.newCorpName).toBe("Shell Co");
    expect(led.confidenceAfter).toBe(73);
    expect(led.turn).toBe(50);

    // Sale broadcasts a resolution notification to the country's residents.
    const { notifyCountryResidents } = await import("./privatizationNotifications");
    expect(vi.mocked(notifyCountryResidents)).toHaveBeenCalledWith(
      db,
      "US",
      expect.objectContaining({ type: "corp_privatization_resolved" })
    );
  });

  it("sold to a corporation: relocates HQ to the buying corp's region", async () => {
    const buyerCorpId = new ObjectId();
    const auction = baseAuction({
      corporationId: shellId,
      primaryNationalCorporationId: primaryId,
      goldenSharePercent: 0,
      bids: [{ corporationId: buyerCorpId, amount: 5000, escrowCurrency: "USD", placedAtTurn: 3 }],
    });
    // The resolver loads the shell (by auction.corporationId) and the buying corp.
    db.collectionMocks.corporations.findOne.mockImplementation((q: { _id: ObjectId }) => {
      if (q._id?.toString() === shellId.toString()) {
        return Promise.resolve({
          _id: shellId,
          name: "Shell Co",
          totalShares: 10_000_000,
          sequentialId: 9,
        });
      }
      if (q._id?.toString() === buyerCorpId.toString()) {
        return Promise.resolve({ _id: buyerCorpId, headquartersState: "TX" });
      }
      return Promise.resolve(null);
    });

    const { resolveNationalizationAuction } = await import("./privatizationAuction");
    const result = await resolveNationalizationAuction(db as unknown as Db, auction as never, 50);

    expect(result).toBe("sold");
    const upd = db.collectionMocks.corporations.updateOne.mock.calls.find(
      (c) => c[1].$set?.shareholders
    );
    expect(upd![1].$set.shareholders).toEqual([{ corporationId: buyerCorpId, shares: 10_000_000 }]);
    expect(upd![1].$set.ceoVacant).toBe(true);
    // HQ relocates to the buying corporation's region.
    expect(upd![1].$set.headquartersState).toBe("TX");
  });

  it("passed-in: refunds all bids and re-absorbs the carve-out", async () => {
    const auction = baseAuction({
      corporationId: shellId,
      primaryNationalCorporationId: primaryId,
      bids: [{ characterId: loserId, amount: 500, escrowCurrency: "USD", placedAtTurn: 1 }], // below reserve 1000
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: shellId,
      countryId: "US",
      liquidCapital: 0,
      sequentialId: 9,
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const { resolveNationalizationAuction } = await import("./privatizationAuction");
    const { refundCharacterCash } = await import("@/lib/financialTxLog/atomicCashGuard");

    const result = await resolveNationalizationAuction(db as unknown as Db, auction as never, 60);

    expect(result).toBe("passedIn");
    expect(vi.mocked(refundCharacterCash)).toHaveBeenCalledWith(db, loserId, "USD", 500, false);
    expect(db.collectionMocks.corporations.deleteOne).toHaveBeenCalledWith({ _id: shellId });

    // Pass-in re-absorbs (no privatization happened) → no consequences.
    const { applyPrivatizationConsequences } = await import("./consequences/apply");
    expect(vi.mocked(applyPrivatizationConsequences)).not.toHaveBeenCalled();

    // Residents are still told it returned to state ownership.
    const { notifyCountryResidents } = await import("./privatizationNotifications");
    expect(vi.mocked(notifyCountryResidents)).toHaveBeenCalledWith(
      db,
      "US",
      expect.objectContaining({ type: "corp_privatization_resolved" })
    );
  });

  it("sweep isolates a failing auction and still resolves the rest", async () => {
    db.collectionMocks.nationalizationAuctions.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          baseAuction({ _id: new ObjectId(), bids: [] }),
          baseAuction({ _id: new ObjectId(), bids: [] }),
        ]),
      sort: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    // First claim throws → isolated; second resolves (no winner, no shell → passedIn).
    db.collectionMocks.nationalizationAuctions.updateOne
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);

    const { processNationalizationAuctions } = await import("./privatizationAuction");
    const result = await processNationalizationAuctions(db as unknown as Db, 100);

    expect(result.passedIn).toBe(1);
    expect(result.sold).toBe(0);
  });
});
