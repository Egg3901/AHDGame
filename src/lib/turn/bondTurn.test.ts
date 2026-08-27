/**
 * Unit tests for processBondTurn — bond interest, maturity, and default handling.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/bonds/sovereign", () => ({
  getBondCountryId: vi.fn().mockReturnValue("US"),
  isCorporateBond: vi.fn((b: { isCorporate?: boolean }) => !!b.isCorporate),
  issueScheduledSovereignBondSeries: vi.fn().mockResolvedValue(undefined),
  settleSovereignBondMaturity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/constants/bonds", () => ({
  BOND_DEFAULT_CREDIT_PENALTY_TURNS: 100,
  CORP_BOND_DUE_SOON_REMINDER_TURNS: [12, 4],
  calculateBondMarketPrice: vi.fn().mockReturnValue(1.02),
  calculateCreditScore: vi.fn().mockReturnValue({ rating: "BBB", score: 50 }),
  getBondCouponRate: vi.fn().mockReturnValue(5.0),
  // LOCAL value per post-Task-18B convention — output is in bond.currencyCode,
  // not ₳. bondTurn normalizes LOCAL → ₳ before feeding addCharPayment /
  // corpCouponCosts, which then re-multiply by destination FX.
  perTurnCouponPayment: vi.fn().mockReturnValue(10),
}));
vi.mock("@/lib/db/types/bond", () => ({
  // Per-unit face value in bond.currencyCode (LOCAL) post-Task-18B.
  BOND_UNIT_FACE_VALUE: 1000,
}));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/sovereignDefault/imfSovereignFacilityTurn", () => ({
  processSovereignImfFacilityPayments: vi.fn().mockResolvedValue({ paymentsApplied: 0 }),
}));
vi.mock("@/lib/sovereignDefault/recovery/recoveryTurn", () => ({
  processSovereignRecoveryTurn: vi
    .fn()
    .mockResolvedValue({ countriesEvaluated: 0, countriesExited: [] }),
}));
vi.mock("@/lib/sovereignDefault/legislative/legislativeTurn", () => ({
  processSovereignLegislativeTurn: vi
    .fn()
    .mockResolvedValue({ decisionsEvaluated: 0, ratified: [], rejected: [], advanced: [] }),
}));
vi.mock("@/lib/corporations/sentimentEvents", () => ({
  fireBondDefaultPulse: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));
// Phase-7 auto-resolution seams. Mocked so the ordering test can drive
// refinance-first branching without exercising the full refinance/restructure
// engines (those have their own unit tests).
vi.mock("@/lib/bonds/executeCorporationBondRestructure", () => ({
  executeCorporationBondRestructure: vi.fn(),
}));
vi.mock("@/lib/bonds/executeCorporationBondRefinance", () => ({
  executeCorporationBondRefinance: vi.fn(),
}));
vi.mock("@/lib/corporations/settlementLock", () => ({
  withCorporationSettlementLock: vi.fn(
    async (
      _db: unknown,
      _id: unknown,
      _field: unknown,
      _now: unknown,
      run: () => Promise<unknown>
    ) => run()
  ),
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

describe("processBondTurn", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetCorpFxRateCacheForTests();
    db = createMockDb();
    for (const name of ["bonds", "corporations", "centralBanks", "bondHistory", "characters"]) {
      db.collection(name);
    }
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns zero counts when no active bonds exist", async () => {
    // bonds.find returns empty by default
    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.bondsProcessed).toBe(0);
    expect(result.couponsPaid).toBe(0);
    expect(result.bondsMatured).toBe(0);
    expect(result.bondsDefaulted).toBe(0);
  });

  it("processes coupon payments to character holders", async () => {
    const charId = new ObjectId();
    const bond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      holders: [{ characterId: charId, units: 5 }],
      publicFloat: 0,
      corporationId: new ObjectId(), // all bonds have corporationId in schema
    };

    // First bonds.find returns the active bond
    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      // Second call: updated bonds for history snapshot
      const cursor = makeCursor([{ _id: bond._id, marketPrice: 1.02 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.bondsProcessed).toBe(1);
    expect(result.couponsPaid).toBeGreaterThan(0);
    // Character should receive payment via bulkWrite
    expect(db.collectionMocks["characters"]!.bulkWrite).toHaveBeenCalled();
  });

  it("processes coupon payments to NPP holders (v3)", async () => {
    const nppId = new ObjectId();
    const bond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      holders: [{ nppId, units: 5 }],
      publicFloat: 0,
      corporationId: new ObjectId(),
    };

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([{ _id: bond._id, marketPrice: 1.02 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.couponsPaid).toBeGreaterThan(0);
    // V3 account wall: coupon income is an INVESTMENT return, credited to the
    // NPP's personal forex account (nppInvestmentCashAnchor, ₳) — never to
    // campaign `funds` (see the nppPaymentsAnchor bulkWrite in bondTurn).
    expect(db.collectionMocks["npps"]!.bulkWrite).toHaveBeenCalled();
    const nppOps = db.collectionMocks["npps"]!.bulkWrite.mock.calls[0][0];
    expect(nppOps[0].updateOne.update.$inc.nppInvestmentCashAnchor).toBeGreaterThan(0);
    expect(nppOps[0].updateOne.update.$inc.funds).toBeUndefined();
  });

  it("credits bond coupon income to index fund holders", async () => {
    const fundId = new ObjectId();
    const bond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      holders: [{ fundId, units: 5 }],
      publicFloat: 0,
      corporationId: new ObjectId(),
      issuerName: "Sovereign Test",
      currencyCode: "USD" as const,
    };

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([{ _id: bond._id, marketPrice: 1.02 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.bondsProcessed).toBe(1);
    expect(result.couponsPaid).toBe(1);
    expect(db.collectionMocks["indexFunds"]!.updateOne).toHaveBeenCalled();
    const fundUpdate = vi
      .mocked(db.collectionMocks["indexFunds"]!.updateOne)
      .mock.calls.find((call) => {
        const filter = call[0] as { _id: ObjectId };
        return filter._id.toString() === fundId.toString();
      });
    expect(fundUpdate).toBeDefined();
    const update = fundUpdate![1] as { $inc: { cashAnchor: number } };
    // perTurnCouponPayment mocked to 10; USD fx defaults to 1.0; 5 units => 50
    expect(update.$inc.cashAnchor).toBe(50);
  });

  it("emits a bond_coupon tx for each character holder receiving a coupon", async () => {
    // Pre-fix Phase 1: bondTurn paid character coupons via charPayments map but
    // never pushed a `bond_coupon` row to txBondEntries. Multi-billion-dollar
    // coupon distributions to wealth-list players were therefore invisible in
    // the financial ledger. This regression test pins the new emission.
    const charId = new ObjectId();
    const issuerCorpId = new ObjectId();
    const bondId = new ObjectId();
    const bond = {
      _id: bondId,
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      holders: [{ characterId: charId, units: 5 }],
      publicFloat: 0,
      corporationId: issuerCorpId,
      issuerName: "Test Issuer",
      currencyCode: "USD" as const,
    };

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([{ _id: bond._id, marketPrice: 1.02 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([{ _id: charId, name: "Test Holder" }])
    );

    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(10);

    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTxBulk)).toHaveBeenCalled();
    const allEntries = vi.mocked(emitTxBulk).mock.calls.flatMap((c) => c[1] as unknown[]);
    const couponEntry = allEntries.find(
      (e: unknown) => (e as { type?: string }).type === "bond_coupon"
    ) as
      | {
          type: string;
          subjectType: string;
          subjectId: ObjectId;
          subjectName: string;
          amount: number;
          currencyCode: string;
          counterpartyType?: string;
          meta?: { bondId?: string; units?: number };
        }
      | undefined;
    expect(couponEntry).toBeDefined();
    expect(couponEntry!.subjectType).toBe("character");
    expect(couponEntry!.subjectId.toString()).toBe(charId.toString());
    expect(couponEntry!.subjectName).toBe("Test Holder");
    expect(couponEntry!.amount).toBeGreaterThan(0);
    expect(couponEntry!.currencyCode).toBe("USD");
    expect(couponEntry!.meta?.bondId).toBe(bondId.toString());
    expect(couponEntry!.meta?.units).toBe(5);
  });

  it("waits for bond coupon ledger writes before returning", async () => {
    const charId = new ObjectId();
    const bond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      holders: [{ characterId: charId, units: 2 }],
      publicFloat: 0,
      corporationId: new ObjectId(),
      issuerName: "Await Test Issuer",
      currencyCode: "USD" as const,
    };

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([{ _id: bond._id, marketPrice: 1.02 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([{ _id: charId, name: "Await Holder" }])
    );

    let releaseEmit: (() => void) | undefined;
    const emitDeferred = new Promise<void>((resolve) => {
      releaseEmit = resolve;
    });
    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    vi.mocked(emitTxBulk).mockReturnValueOnce(emitDeferred);

    const { processBondTurn } = await import("./bondTurn");
    let resolved = false;
    const pending = processBondTurn(10).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    releaseEmit?.();
    await pending;
    expect(resolved).toBe(true);
  });

  it("marks matured bonds and settles them", async () => {
    const bond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 10, // Matures this turn
      matured: false,
      defaulted: false,
      countryId: "US",
      corporationId: new ObjectId(),
      holders: [],
      publicFloat: 0,
    };

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.bondsMatured).toBe(1);
    // Bond ops should include matured=true in bulkWrite
    expect(db.collectionMocks["bonds"]!.bulkWrite).toHaveBeenCalled();
    const ops = db.collectionMocks["bonds"]!.bulkWrite.mock.calls[0][0];
    const maturedOp = ops.find(
      (op: { updateOne: { update: { $set: { matured?: boolean } } } }) =>
        op.updateOne.update.$set.matured === true
    );
    expect(maturedOp).toBeDefined();
  });

  it("fires one bond-default pulse per newly defaulted issuer, not per bond", async () => {
    const issuerCorpId = new ObjectId();
    const firstBond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [],
      publicFloat: 0,
      corporationId: issuerCorpId,
    };
    const secondBond = {
      ...firstBond,
      _id: new ObjectId(),
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([firstBond, secondBond]);
      const cursor = makeCursor([
        { _id: firstBond._id, marketPrice: 0.1 },
        { _id: secondBond._id, marketPrice: 0.1 },
      ]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["corporations"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: issuerCorpId,
          liquidCapital: -100,
          countryId: "US",
          name: "Defaulting Corp",
        },
      ])
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(10);

    const { fireBondDefaultPulse } = await import("@/lib/corporations/sentimentEvents");
    expect(vi.mocked(fireBondDefaultPulse)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fireBondDefaultPulse)).toHaveBeenCalledWith(
      expect.anything(),
      issuerCorpId.toString()
    );
  });

  describe("ticket #1198: corporation actions paused", () => {
    // The pause skips `corporationTurn` (sector revenue, operating income,
    // dividends) but not bond servicing, so a paused corp keeps paying coupons
    // with its income switched off. Declaring it insolvent for the resulting
    // cash hole blames the corp for the admin's pause — corporation #624 was
    // defaulted twice that way at turns 416 and 418. Settlement still runs;
    // only the decision to liquidate waits for corporations to be live again.
    function arrangeCashNegativeIssuer(paused: boolean) {
      const issuerCorpId = new ObjectId();
      const bond = {
        _id: new ObjectId(),
        couponRate: 5,
        maturityTurn: 100,
        matured: false,
        defaulted: false,
        isCorporate: true,
        holders: [],
        publicFloat: 0,
        corporationId: issuerCorpId,
      };
      let bondFindCount = 0;
      db.collectionMocks["bonds"]!.find.mockImplementation(() => {
        bondFindCount++;
        if (bondFindCount === 1) return makeCursor([bond]);
        const cursor = makeCursor([{ _id: bond._id, marketPrice: 0.1 }]);
        cursor.project = vi.fn().mockReturnValue(cursor);
        return cursor;
      });
      db.collectionMocks["corporations"]!.find.mockReturnValue(
        makeCursor([
          { _id: issuerCorpId, liquidCapital: -100, countryId: "US", name: "Paused Corp" },
        ])
      );
      db.collectionMocks["centralBanks"]!.find.mockReturnValue(makeCursor([]));
      db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      });
      db.collection("gameState");
      db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
        _id: "current",
        currentTurn: 10,
        corporationActionsPaused: paused,
      });
      return issuerCorpId;
    }

    it("does NOT default a cash-negative issuer while paused", async () => {
      arrangeCashNegativeIssuer(true);
      const { processBondTurn } = await import("./bondTurn");
      const result = await processBondTurn(10);

      expect(result.bondsDefaulted).toBe(0);
      const { fireBondDefaultPulse } = await import("@/lib/corporations/sentimentEvents");
      expect(vi.mocked(fireBondDefaultPulse)).not.toHaveBeenCalled();
    });

    it("does NOT stamp a credit penalty while paused", async () => {
      arrangeCashNegativeIssuer(true);
      const { processBondTurn } = await import("./bondTurn");
      await processBondTurn(10);

      // The only corporations.updateMany is the expiry sweep at the top of the
      // turn; no penalty is written while paused.
      const penaltyWrites = db.collectionMocks["corporations"]!.bulkWrite.mock.calls.filter(
        (call) => JSON.stringify(call[0] ?? "").includes("bondDefaultCreditPenaltyUntilTurn")
      );
      expect(penaltyWrites).toHaveLength(0);
    });

    it("still settles the turn's bond obligations while paused", async () => {
      arrangeCashNegativeIssuer(true);
      const { processBondTurn } = await import("./bondTurn");
      const result = await processBondTurn(10);

      // Settlement is contractual and must not be skipped: sovereign holders
      // would lose income for an unrelated corporation pause.
      expect(result.bondsProcessed).toBeGreaterThan(0);
    });

    it("DOES default the same issuer once corporations are live again", async () => {
      arrangeCashNegativeIssuer(false);
      const { processBondTurn } = await import("./bondTurn");
      const result = await processBondTurn(10);

      expect(result.bondsDefaulted).toBe(1);
      const { fireBondDefaultPulse } = await import("@/lib/corporations/sentimentEvents");
      expect(vi.mocked(fireBondDefaultPulse)).toHaveBeenCalledTimes(1);
    });

    it("does NOT auto-resolve lingering defaults while paused", async () => {
      // Phase 7 can sell a corp's sectors. It justifies that by saying the CEO
      // had a turn to act, but all four cure routes are pause-gated, so during
      // a pause they were locked out of the very window being held against them.
      arrangeCashNegativeIssuer(true);
      const { processBondTurn } = await import("./bondTurn");
      const result = await processBondTurn(10);

      expect(result.bondsAutoRestructured).toBe(0);
      expect(result.bondsAutoRefinanced).toBe(0);
      expect(db.collectionMocks["bonds"]!.distinct).not.toHaveBeenCalled();
    });

    it("treats a missing gameState as not paused, so detection is never silently disabled", async () => {
      arrangeCashNegativeIssuer(false);
      db.collectionMocks["gameState"]!.findOne.mockResolvedValue(null);
      const { processBondTurn } = await import("./bondTurn");
      const result = await processBondTurn(10);

      expect(result.bondsDefaulted).toBe(1);
    });
  });

  it("clears expired bond default credit penalties", async () => {
    // bonds.find returns empty (no active bonds)
    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(10);

    // Should clear expired penalties
    expect(db.collectionMocks["corporations"]!.updateMany).toHaveBeenCalledWith(
      { bondDefaultCreditPenaltyUntilTurn: { $lte: 10 } },
      expect.objectContaining({ $unset: { bondDefaultCreditPenaltyUntilTurn: "" } })
    );
  });

  it("issues scheduled sovereign bonds", async () => {
    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(10);

    const { issueScheduledSovereignBondSeries } = await import("@/lib/bonds/sovereign");
    expect(issueScheduledSovereignBondSeries).toHaveBeenCalledWith(
      expect.anything(),
      10,
      expect.any(Date)
    );
  });

  it("invokes processSovereignImfFacilityPayments each turn", async () => {
    const { processSovereignImfFacilityPayments } =
      await import("@/lib/sovereignDefault/imfSovereignFacilityTurn");
    vi.mocked(processSovereignImfFacilityPayments).mockClear();
    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(100);
    expect(processSovereignImfFacilityPayments).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processSovereignImfFacilityPayments).mock.calls[0][1]).toBe(100);
  });

  it("invokes processSovereignRecoveryTurn each turn", async () => {
    const { processSovereignRecoveryTurn } =
      await import("@/lib/sovereignDefault/recovery/recoveryTurn");
    vi.mocked(processSovereignRecoveryTurn).mockClear();
    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(100);
    expect(processSovereignRecoveryTurn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processSovereignRecoveryTurn).mock.calls[0][1]).toBe(100);
  });

  it("invokes processSovereignLegislativeTurn each turn", async () => {
    const { processSovereignLegislativeTurn } =
      await import("@/lib/sovereignDefault/legislative/legislativeTurn");
    vi.mocked(processSovereignLegislativeTurn).mockClear();
    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(100);
    expect(processSovereignLegislativeTurn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processSovereignLegislativeTurn).mock.calls[0][2]).toBe(100);
  });

  it("pays coupon income to corporate holders (not just characters)", async () => {
    const holderCorpId = new ObjectId(); // corporation that holds the bond
    const issuerCorpId = new ObjectId(); // corporation that issued the bond
    const bond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      // isCorporateBond returns true based on isCorporate flag mock: !!b.isCorporate
      isCorporate: false,
      // Holder is a corporation, not a character
      holders: [{ corporationId: holderCorpId, units: 3 }],
      publicFloat: 0,
      corporationId: issuerCorpId,
    };

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([{ _id: bond._id, marketPrice: 1.01 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.couponsPaid).toBeGreaterThan(0);
    // Corp holding the bond should receive liquidCapital increment
    const corpBulkWrite = db.collectionMocks["corporations"]!.bulkWrite;
    expect(corpBulkWrite).toHaveBeenCalled();
    const allOps = corpBulkWrite.mock.calls.flatMap((call: unknown[]) => call[0] as unknown[]);
    const holderPayOp = allOps.find(
      (op: any) =>
        op.updateOne?.filter?._id?.toString() === holderCorpId.toString() &&
        op.updateOne?.update?.$inc?.liquidCapital > 0
    );
    expect(holderPayOp).toBeDefined();
  });

  it("anchor-normalizes LOCAL coupon before bond-country FX payout (forex)", async () => {
    // Post-Task-18B JP sovereign bond: perTurnCouponPayment mock = 10 (LOCAL JPY per unit).
    // bondTurn normalizes 10 JPY → 0.1 ₳ via JPY rate 100, then addCharPayment applies the
    // same rate again to land ¥40 in currencyBalances.personal.JPY — i.e. the bond's native
    // LOCAL coupon, NOT the pre-fix ¥4000 (which double-applied FX and over-paid by 100×).
    const charId = new ObjectId();
    const bond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      isCorporate: false,
      countryId: "JP",
      holders: [{ characterId: charId, units: 4 }],
      publicFloat: 0,
      corporationId: new ObjectId(),
    };

    const { getBondCountryId } = await import("@/lib/bonds/sovereign");
    vi.mocked(getBondCountryId).mockReturnValue("JP");

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([{ _id: bond._id, marketPrice: 1.01 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });

    db.collection("exchangeRates");
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ currencyCode: "JPY", rate: 100 }]),
    });

    // Enable forex so credit routes to currencyBalances.personal.JPY (the broken path).
    db.collection("gameState");
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      forexEnabled: true,
    });

    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([{ _id: charId, countryId: "JP" }])
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(10);

    const charBulkWrite = db.collectionMocks["characters"]!.bulkWrite;
    expect(charBulkWrite).toHaveBeenCalled();
    const allOps = charBulkWrite.mock.calls.flatMap(
      (call: unknown[]) => call[0] as unknown[]
    ) as Array<{
      updateOne?: {
        filter?: { _id?: ObjectId };
        update?: { $inc?: Record<string, number> };
      };
    }>;
    const jpyOp = allOps.find(
      (op) =>
        op.updateOne?.filter?._id?.toString() === charId.toString() &&
        typeof op.updateOne?.update?.$inc?.["currencyBalances.personal.JPY"] === "number"
    );
    expect(jpyOp).toBeDefined();
    const jpyAmt = jpyOp!.updateOne!.update!.$inc!["currencyBalances.personal.JPY"];
    // LOCAL JPY at source = 10 × 4 = 40. After LOCAL → ₳ (÷100) and ₳ → JPY (×100)
    // in addCharPayment, the holder lands at exactly ¥40 — the bond's face LOCAL
    // coupon. Pre-A13 (broken) this path produced ¥4000 via double FX.
    expect(jpyAmt).toBe(40);
  });

  it("converts corporate holder coupon from anchor units to home currency (forex)", async () => {
    const holderCorpId = new ObjectId();
    const issuerCorpId = new ObjectId();
    const bond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      isCorporate: false,
      holders: [{ corporationId: holderCorpId, units: 3 }],
      publicFloat: 0,
      corporationId: issuerCorpId,
    };

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([{ _id: bond._id, marketPrice: 1.01 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });

    db.collection("exchangeRates");
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ currencyCode: "JPY", rate: 106 }]),
    });

    db.collectionMocks["corporations"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: holderCorpId,
          countryId: "JP",
          liquidCurrencyCode: "JPY",
          liquidCapital: 1_000_000,
        },
      ])
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(10);

    // Bond has no currencyCode/countryId (pre-migration convention) so it
    // resolves to USD; the JPY holder corp is cross-currency, so the 1% FX
    // spread is skimmed before crediting. perTurnCouponPayment mock = 10; 3 units
    // => 30 ₳; net after 1% spread = 29.7 ₳; anchorToCorpCapital(29.7, JPY, 106)
    // => 3148.2 JPY credited.
    const corpBulkWrite = db.collectionMocks["corporations"]!.bulkWrite;
    const allOps = corpBulkWrite.mock.calls.flatMap(
      (call: unknown[]) => call[0] as unknown[]
    ) as Array<{
      updateOne?: { filter?: { _id?: ObjectId }; update?: { $inc?: { liquidCapital?: number } } };
    }>;
    const holderPayOp = allOps.find(
      (op) =>
        op.updateOne?.filter?._id?.toString() === holderCorpId.toString() &&
        op.updateOne?.update?.$inc?.liquidCapital === 3148.2
    );
    expect(holderPayOp).toBeDefined();
  });

  it("charges corporate issuer for public float coupon costs", async () => {
    // Public float units incur coupon cost for the issuing corporation
    const issuerCorpId = new ObjectId();
    const bond = {
      _id: new ObjectId(),
      couponRate: 8,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [], // No named holders
      publicFloat: 10, // 10 units in the public float
      corporationId: issuerCorpId,
    };

    // isCorporateBond mock uses !!b.isCorporate
    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([{ _id: bond._id, marketPrice: 1.0 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["corporations"]!.find.mockReturnValue(
      makeCursor([{ _id: issuerCorpId, liquidCapital: 500_000, countryId: "US" }])
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(10);

    // The issuing corporation should have liquidCapital decremented for public float coupons
    const corpBulkWrite = db.collectionMocks["corporations"]!.bulkWrite;
    expect(corpBulkWrite).toHaveBeenCalled();
    const allOps = corpBulkWrite.mock.calls.flatMap((call: unknown[]) => call[0] as unknown[]);
    const costDeductOp = allOps.find(
      (op: any) =>
        op.updateOne?.filter?._id?.toString() === issuerCorpId.toString() &&
        op.updateOne?.update?.$inc?.liquidCapital < 0
    );
    expect(costDeductOp).toBeDefined();
  });

  it("marks corporate bond as defaulted when issuer goes negative after coupon deductions", async () => {
    const issuerCorpId = new ObjectId();
    const bondId = new ObjectId();
    const bond = {
      _id: bondId,
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [{ characterId: new ObjectId(), units: 5 }],
      publicFloat: 0,
      corporationId: issuerCorpId,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    let corpFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      // After price update, return bond still active
      const cursor = makeCursor([{ _id: bondId, marketPrice: 0.5 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["corporations"]!.find.mockImplementation(() => {
      corpFindCount++;
      if (corpFindCount === 1) {
        // Initial fetch for corp data
        return makeCursor([{ _id: issuerCorpId, liquidCapital: 5, countryId: "US" }]);
      }
      // After coupon deduction, corp is now negative (simulating deduction happened)
      const cursor = makeCursor([{ _id: issuerCorpId, liquidCapital: -50 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.bondsDefaulted).toBe(1);

    // Bond bulkWrite should include defaulted: true
    const bondBulkWrite = db.collectionMocks["bonds"]!.bulkWrite;
    expect(bondBulkWrite).toHaveBeenCalled();
    const allOps = bondBulkWrite.mock.calls.flatMap((call: unknown[]) => call[0] as unknown[]);
    const defaultOp = allOps.find((op: any) => op.updateOne?.update?.$set?.defaulted === true);
    expect(defaultOp).toBeDefined();
    expect((defaultOp as any).updateOne.update.$set.marketPrice).toBe(0.1);
  });

  it("returns face value to character holders when bond matures", async () => {
    const charId = new ObjectId();
    const bondId = new ObjectId();
    const bond = {
      _id: bondId,
      couponRate: 5,
      maturityTurn: 10, // Matures this turn
      matured: false,
      defaulted: false,
      isCorporate: false,
      holders: [{ characterId: charId, units: 2 }], // 2 units × $1000 face = $2000 return
      publicFloat: 0,
      corporationId: new ObjectId(),
    };

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      // After maturity, no active bonds
      const cursor = makeCursor([]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.bondsMatured).toBe(1);

    // Character should have received face value repayment via bulkWrite
    // Post-forex: payments go to currencyBalances.personal.<ccy> not cashOnHand.
    const charBulkWrite = db.collectionMocks["characters"]!.bulkWrite;
    expect(charBulkWrite).toHaveBeenCalled();
    const allOps = charBulkWrite.mock.calls.flatMap((call: unknown[]) => call[0] as unknown[]);
    const repayOp = allOps.find(
      (op: any) =>
        op.updateOne?.filter?._id?.toString() === charId.toString() &&
        Object.values(op.updateOne?.update?.$inc ?? {}).some((v: unknown) => (v as number) > 0)
    );
    expect(repayOp).toBeDefined();
    // 2 units × $1000 face value + coupon. Face value is $2000.
    // Post-forex the $inc key is currencyBalances.personal.USD (or bond currency).
    const inc = (repayOp as any).updateOne.update.$inc;
    const received = Object.values(inc).find((v: unknown) => (v as number) > 0) as number;
    expect(received).toBeGreaterThanOrEqual(2000);
  });

  it("auto-redeems a matured bond: pays face value exactly once and clears holders (#2974)", async () => {
    const charId = new ObjectId();
    const bondId = new ObjectId();
    const bond = {
      _id: bondId,
      couponRate: 5,
      maturityTurn: 10, // Matures this turn
      matured: false,
      defaulted: false,
      isCorporate: false,
      holders: [{ characterId: charId, units: 2 }], // 2 units × $1000 face = $2000
      publicFloat: 0,
      corporationId: new ObjectId(),
    };

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.bondsMatured).toBe(1);

    // The bond bulkWrite op must mark it redeemed AND clear the holdings so the
    // position cannot linger as a phantom in holder-based views.
    const bondBulk = db.collectionMocks["bonds"]!.bulkWrite;
    expect(bondBulk).toHaveBeenCalled();
    const bondOps = bondBulk.mock.calls.flatMap((call: unknown[]) => call[0] as unknown[]);
    const maturedOp = bondOps.find(
      (op: any) =>
        op.updateOne?.filter?._id?.toString() === bondId.toString() &&
        op.updateOne?.update?.$set?.matured === true
    ) as any;
    expect(maturedOp).toBeDefined();
    expect(maturedOp.updateOne.update.$set.holders).toEqual([]);
    expect(maturedOp.updateOne.update.$set.redeemedAtTurn).toBe(10);
    expect(maturedOp.updateOne.update.$set.publicFloat).toBe(0);

    // Face value credited exactly once: a single positive credit to the holder.
    const charBulkWrite = db.collectionMocks["characters"]!.bulkWrite;
    const allOps = charBulkWrite.mock.calls.flatMap((call: unknown[]) => call[0] as unknown[]);
    const holderCredits = allOps.filter(
      (op: any) =>
        op.updateOne?.filter?._id?.toString() === charId.toString() &&
        Object.values(op.updateOne?.update?.$inc ?? {}).some((v: unknown) => (v as number) > 0)
    );
    expect(holderCredits).toHaveLength(1);
    const inc = (holderCredits[0] as any).updateOne.update.$inc;
    const received = Object.values(inc).find((v: unknown) => (v as number) > 0) as number;
    // $2000 face + one turn's coupon; must not be a double face-value payment.
    expect(received).toBeGreaterThanOrEqual(2000);
    expect(received).toBeLessThan(4000);
  });

  it("deducts total face value (including public float) from issuing corp on corporate bond maturity", async () => {
    const issuerCorpId = new ObjectId();
    const bondId = new ObjectId();
    const bond = {
      _id: bondId,
      couponRate: 5,
      maturityTurn: 10, // Matures this turn
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [{ characterId: new ObjectId(), units: 3 }],
      publicFloat: 7, // 7 units in float = 10 total units × $1000 = $10,000 repayment
      corporationId: issuerCorpId,
      countryId: undefined, // corporate bond, not sovereign
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["corporations"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: issuerCorpId,
          liquidCapital: 100_000,
          countryId: "US",
          userId: new ObjectId(),
          name: "Issuer Inc",
          sequentialId: 7,
        },
      ])
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { createNotifications } = await import("@/lib/notifications");
    vi.mocked(createNotifications).mockClear();

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.bondsMatured).toBe(1);

    // Post default-ordering fix the issuer is debited via Phase 2's unified
    // delta bulkWrite. Total = $10,000 face value (10 units × $1000) plus
    // $100 turn coupon (10 units × mocked $10 coupon-per-unit) — both flow
    // through the same per-corp delta so the default check observes them.
    const corpBulkWrite = db.collectionMocks["corporations"]!.bulkWrite;
    const allCorpOps = corpBulkWrite.mock.calls.flatMap(
      (call: unknown[]) => call[0] as unknown[]
    ) as Array<{
      updateOne?: { filter?: { _id?: ObjectId }; update?: { $inc?: { liquidCapital?: number } } };
    }>;
    const issuerDebit = allCorpOps.find(
      (op) => op.updateOne?.filter?._id?.toString() === bond.corporationId.toString()
    );
    expect(issuerDebit).toBeDefined();
    expect(issuerDebit!.updateOne!.update!.$inc!.liquidCapital!).toBe(-10_100);

    expect(createNotifications).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          type: "corp_bond_repaid",
          title: "Corporate bond matured",
          metadata: expect.objectContaining({ bondId: bondId.toString() }),
        }),
      ])
    );
  });

  it("emits an issuer-side bond_coupon tx (negative) per corporate bond on each turn", async () => {
    // Pre-fix Phase 2: bondTurn aggregated coupon costs into corpCouponCosts,
    // deducted them via $inc, and never emitted a tx row. Holder-side coupon
    // inflows were logged (per Phase 1), but the issuer's matching outflow
    // was invisible — billions in coupon obligations went unaudited.
    const issuerCorpId = new ObjectId();
    const charHolderId = new ObjectId();
    const bondId = new ObjectId();
    const bond = {
      _id: bondId,
      couponRate: 5,
      maturityTurn: 100, // not maturing this turn
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [{ characterId: charHolderId, units: 4 }],
      publicFloat: 6, // 4 + 6 = 10 total units paying coupon
      corporationId: issuerCorpId,
      currencyCode: "USD" as const,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([{ _id: bondId, marketPrice: 1.02 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["corporations"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: issuerCorpId,
          liquidCapital: 10_000,
          countryId: "US",
          name: "Issuer Inc",
          sequentialId: 7,
        },
      ])
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(10);

    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    const allEntries = vi.mocked(emitTxBulk).mock.calls.flatMap((c) => c[1] as unknown[]);
    const issuerCouponEntry = allEntries.find(
      (e: unknown) =>
        (e as { type?: string }).type === "bond_coupon" &&
        (e as { subjectType?: string }).subjectType === "corporation" &&
        (e as { subjectId?: ObjectId }).subjectId?.toString() === issuerCorpId.toString()
    ) as
      | {
          subjectName: string;
          amount: number;
          currencyCode: string;
          meta?: { bondId?: string; source?: string; units?: number };
        }
      | undefined;
    expect(issuerCouponEntry).toBeDefined();
    expect(issuerCouponEntry!.subjectName).toBe("Issuer Inc");
    // Outflow: amount must be negative (issuer paying coupons out).
    expect(issuerCouponEntry!.amount).toBeLessThan(0);
    expect(issuerCouponEntry!.currencyCode).toBe("USD");
    expect(issuerCouponEntry!.meta?.bondId).toBe(bondId.toString());
    expect(issuerCouponEntry!.meta?.source).toBe("issuer_coupon");
    expect(issuerCouponEntry!.meta?.units).toBe(10);
  });

  it("emits a gov_bond_maturity_payment tx when a sovereign bond matures", async () => {
    // Pre-fix Phase 5 sovereign branch: bondTurn called settleSovereignBondMaturity
    // (which only adjusts federal budget debt/spending) and credited holders, but
    // never emitted a tx row for the government's outflow. The aggregated
    // gov_coupon_payment had a sibling pattern, but maturity payouts had none.
    const charHolderId = new ObjectId();
    const bondId = new ObjectId();
    const bond = {
      _id: bondId,
      couponRate: 5,
      maturityTurn: 10, // matures this turn
      matured: false,
      defaulted: false,
      isCorporate: false,
      holders: [{ characterId: charHolderId, units: 3 }],
      publicFloat: 7, // 3 + 7 = 10 units × $1000
      corporationId: new ObjectId(), // schema requires it; sovereign path uses countryId
      countryId: "US",
      currencyCode: "USD" as const,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(false);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(10);

    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    const allEntries = vi.mocked(emitTxBulk).mock.calls.flatMap((c) => c[1] as unknown[]);
    const govEntry = allEntries.find(
      (e: unknown) =>
        (e as { type?: string }).type === "gov_bond_maturity_payment" &&
        (e as { countryId?: string }).countryId === "US"
    ) as
      | {
          subjectType: string;
          subjectName: string;
          countryId: string;
          amount: number;
          currencyCode: string;
          meta?: { bondId?: string; units?: number };
        }
      | undefined;
    expect(govEntry).toBeDefined();
    expect(govEntry!.subjectType).toBe("government");
    expect(govEntry!.subjectName).toBe("US Government");
    // Outflow: amount must be negative.
    expect(govEntry!.amount).toBeLessThan(0);
    expect(govEntry!.currencyCode).toBe("USD");
    expect(govEntry!.meta?.bondId).toBe(bondId.toString());
    expect(govEntry!.meta?.units).toBe(10);
  });

  it("emits a bond_maturity tx for the issuing corp paying out face value", async () => {
    // Pre-fix Phase 5: bondTurn deducted face value from the issuing corp's
    // liquidCapital silently — no financialTxLog row recorded the outflow.
    // Holder-side rows captured inflows, but the corp's matching debit was
    // invisible to wealth audits and reconciliation. This pins the new
    // issuer-side emission so every maturity is double-entry visible.
    const issuerCorpId = new ObjectId();
    const charHolderId = new ObjectId();
    const bondId = new ObjectId();
    const bond = {
      _id: bondId,
      couponRate: 5,
      maturityTurn: 10, // matures this turn
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [{ characterId: charHolderId, units: 3 }],
      publicFloat: 7, // 3 + 7 = 10 units × $1000 = $10,000 repayment
      corporationId: issuerCorpId,
      countryId: undefined,
      currencyCode: "USD" as const,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["corporations"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: issuerCorpId,
          liquidCapital: 100_000,
          countryId: "US",
          name: "Issuer Inc",
          sequentialId: 7,
        },
      ])
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(10);

    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    const allEntries = vi.mocked(emitTxBulk).mock.calls.flatMap((c) => c[1] as unknown[]);
    const issuerEntry = allEntries.find(
      (e: unknown) =>
        (e as { type?: string }).type === "bond_maturity" &&
        (e as { subjectType?: string }).subjectType === "corporation" &&
        (e as { subjectId?: ObjectId }).subjectId?.toString() === issuerCorpId.toString()
    ) as
      | {
          type: string;
          subjectType: string;
          subjectId: ObjectId;
          subjectName: string;
          amount: number;
          currencyCode: string;
          meta?: { bondId?: string; source?: string };
        }
      | undefined;
    expect(issuerEntry).toBeDefined();
    expect(issuerEntry!.subjectName).toBe("Issuer Inc");
    // Outflow: amount must be negative (issuer paying face value out).
    expect(issuerEntry!.amount).toBeLessThan(0);
    expect(issuerEntry!.currencyCode).toBe("USD");
    expect(issuerEntry!.meta?.bondId).toBe(bondId.toString());
    expect(issuerEntry!.meta?.source).toBe("issuer_repayment");
  });

  it("emits a bond_maturity tx for each corporation holder receiving face value", async () => {
    // Pre-fix Phase 5: corp-holder maturity payouts only credited the
    // corpPayments map and silently $inc'd liquidCapital — no
    // financialTxLog row was emitted. A corp holding e.g. a £500M
    // sovereign bond received the full face value at maturity with zero
    // ledger trail, while character/imperial holders got bond_maturity
    // rows. This regression test pins the new emission for corp holders.
    const corpHolderId = new ObjectId();
    const issuerCorpId = new ObjectId();
    const bondId = new ObjectId();
    const bond = {
      _id: bondId,
      couponRate: 5,
      maturityTurn: 10, // matures this turn
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [{ corporationId: corpHolderId, units: 4 }], // 4 × $1000 face = $4000
      publicFloat: 0,
      corporationId: issuerCorpId,
      issuerName: "Test Issuer",
      currencyCode: "USD" as const,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      // After maturity, no active bonds remain
      const cursor = makeCursor([]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["corporations"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: issuerCorpId,
          liquidCapital: 100_000,
          countryId: "US",
          name: "Issuer Inc",
          sequentialId: 7,
        },
        {
          _id: corpHolderId,
          liquidCapital: 50_000,
          countryId: "US",
          name: "Holder Corp",
          sequentialId: 9,
        },
      ])
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(10);

    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    const allEntries = vi.mocked(emitTxBulk).mock.calls.flatMap((c) => c[1] as unknown[]);
    const maturityEntry = allEntries.find(
      (e: unknown) =>
        (e as { type?: string }).type === "bond_maturity" &&
        (e as { subjectType?: string }).subjectType === "corporation"
    ) as
      | {
          type: string;
          subjectType: string;
          subjectId: ObjectId;
          subjectName: string;
          amount: number;
          currencyCode: string;
          meta?: { bondId?: string; units?: number };
        }
      | undefined;
    expect(maturityEntry).toBeDefined();
    expect(maturityEntry!.subjectId.toString()).toBe(corpHolderId.toString());
    expect(maturityEntry!.subjectName).toBe("Holder Corp");
    expect(maturityEntry!.amount).toBeGreaterThan(0);
    expect(maturityEntry!.currencyCode).toBe("USD");
    expect(maturityEntry!.meta?.bondId).toBe(bondId.toString());
    expect(maturityEntry!.meta?.units).toBe(4);
  });

  it("logs corporate holder coupon receipts in holder currency with bond-side meta", async () => {
    const holderCorpId = new ObjectId();
    const issuerCorpId = new ObjectId();
    const bondId = new ObjectId();
    const bond = {
      _id: bondId,
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [{ corporationId: holderCorpId, units: 3 }],
      publicFloat: 0,
      corporationId: issuerCorpId,
      issuerName: "Sterling Issuer",
      currencyCode: "GBP" as const,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([{ _id: bondId, marketPrice: 1.02 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collection("exchangeRates");
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { currencyCode: "GBP", rate: 0.8 },
        { currencyCode: "JPY", rate: 100 },
      ]),
    });
    db.collectionMocks["corporations"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: issuerCorpId,
          liquidCapital: 10_000,
          countryId: "UK",
          liquidCurrencyCode: "GBP",
          name: "Sterling Issuer",
        },
        {
          _id: holderCorpId,
          liquidCapital: 50_000,
          countryId: "JP",
          liquidCurrencyCode: "JPY",
          name: "Tokyo Holder",
        },
      ])
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "UK", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(10);

    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    const allEntries = vi.mocked(emitTxBulk).mock.calls.flatMap((c) => c[1] as unknown[]);
    const couponEntry = allEntries.find(
      (e: unknown) =>
        (e as { type?: string }).type === "bond_coupon" &&
        (e as { subjectType?: string }).subjectType === "corporation" &&
        (e as { subjectId?: ObjectId }).subjectId?.toString() === holderCorpId.toString()
    ) as
      | {
          amount: number;
          currencyCode: string;
          meta?: { bondCurrency?: string; bondAmount?: number };
        }
      | undefined;
    expect(couponEntry).toBeDefined();
    expect(couponEntry!.currencyCode).toBe("JPY");
    expect(couponEntry!.amount).toBe(3750);
    expect(couponEntry!.meta?.bondCurrency).toBe("GBP");
    expect(couponEntry!.meta?.bondAmount).toBe(30);
  });

  it("logs corporate holder maturity receipts in holder currency with bond-side meta", async () => {
    const holderCorpId = new ObjectId();
    const issuerCorpId = new ObjectId();
    const bondId = new ObjectId();
    const bond = {
      _id: bondId,
      couponRate: 5,
      maturityTurn: 10,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [{ corporationId: holderCorpId, units: 4 }],
      publicFloat: 0,
      corporationId: issuerCorpId,
      issuerName: "Sterling Issuer",
      currencyCode: "GBP" as const,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collection("exchangeRates");
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { currencyCode: "GBP", rate: 0.8 },
        { currencyCode: "JPY", rate: 100 },
      ]),
    });
    db.collectionMocks["corporations"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: issuerCorpId,
          liquidCapital: 100_000,
          countryId: "UK",
          liquidCurrencyCode: "GBP",
          userId: new ObjectId(),
          name: "Sterling Issuer",
        },
        {
          _id: holderCorpId,
          liquidCapital: 50_000,
          countryId: "JP",
          liquidCurrencyCode: "JPY",
          name: "Tokyo Holder",
        },
      ])
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(10);

    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    const allEntries = vi.mocked(emitTxBulk).mock.calls.flatMap((c) => c[1] as unknown[]);
    const maturityEntry = allEntries.find(
      (e: unknown) =>
        (e as { type?: string }).type === "bond_maturity" &&
        (e as { subjectType?: string }).subjectType === "corporation" &&
        (e as { subjectId?: ObjectId }).subjectId?.toString() === holderCorpId.toString()
    ) as
      | {
          amount: number;
          currencyCode: string;
          meta?: { bondCurrency?: string; bondAmount?: number };
        }
      | undefined;
    expect(maturityEntry).toBeDefined();
    expect(maturityEntry!.currencyCode).toBe("JPY");
    expect(maturityEntry!.amount).toBe(500000);
    expect(maturityEntry!.meta?.bondCurrency).toBe("GBP");
    expect(maturityEntry!.meta?.bondAmount).toBe(4000);
  });

  it("notifies issuer when a corporate bond is due soon (12 turns before maturity)", async () => {
    const issuerCorpId = new ObjectId();
    const userId = new ObjectId();
    const bondId = new ObjectId();
    const bond = {
      _id: bondId,
      couponRate: 5,
      maturityTurn: 112,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [{ characterId: new ObjectId(), units: 1 }],
      publicFloat: 0,
      corporationId: issuerCorpId,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([{ _id: bondId, marketPrice: 1.02 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["corporations"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: issuerCorpId,
          liquidCapital: 500_000,
          countryId: "US",
          userId,
          name: "Acme Corp",
          sequentialId: 42,
        },
      ])
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { createNotifications } = await import("@/lib/notifications");
    vi.mocked(createNotifications).mockClear();

    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(100);

    expect(createNotifications).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          userId,
          type: "corp_bond_due_soon",
          title: "Corporate bond nearing maturity",
          metadata: expect.objectContaining({
            bondId: bondId.toString(),
            turnsRemaining: 12,
            corporationSequentialId: 42,
          }),
        }),
      ])
    );
  });

  it("writes bond price history snapshot for active non-matured bonds", async () => {
    const bondId = new ObjectId();
    const bond = {
      _id: bondId,
      couponRate: 5,
      maturityTurn: 50, // Not maturing this turn
      matured: false,
      defaulted: false,
      isCorporate: false,
      holders: [{ characterId: new ObjectId(), units: 1 }],
      publicFloat: 0,
      corporationId: new ObjectId(),
    };

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      // Second call returns the updated bond with new market price
      const cursor = makeCursor([{ _id: bondId, marketPrice: 1.02 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 3.0 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.bondHistorySnapshots).toBe(1);
    expect(db.collectionMocks["bondHistory"]!.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          bondId,
          turn: 10,
          marketPrice: 1.02,
          totalInterestPaid: expect.any(Number),
          createdAt: expect.any(Date),
        }),
      ])
    );
  });

  it("accumulates totalInterestPaid from prior history when writing bond snapshots", async () => {
    const bondId = new ObjectId();
    const bond = {
      _id: bondId,
      couponRate: 5,
      maturityTurn: 50,
      matured: false,
      defaulted: false,
      isCorporate: false,
      holders: [{ characterId: new ObjectId(), units: 2 }],
      publicFloat: 0,
      corporationId: new ObjectId(),
    };

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([{ _id: bondId, marketPrice: 0.99 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(makeCursor([]));
    // Simulate prior history — bond has already paid $50 interest
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: bondId, maxInterest: 50 }]),
    });

    const { processBondTurn } = await import("./bondTurn");
    await processBondTurn(10);

    const insertCalls = db.collectionMocks["bondHistory"]!.insertMany.mock.calls;
    expect(insertCalls.length).toBe(1);
    const historyDoc = insertCalls[0][0][0];
    // totalInterestPaid should be prior ($50) + this turn's coupon
    // perTurnCouponPayment mock returns 10 per call, 2 units = 20 this turn
    expect(historyDoc.totalInterestPaid).toBeGreaterThan(50);
  });

  it("does not write bond history when all bonds have matured (no active bonds after turn)", async () => {
    const bond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 10,
      matured: false,
      defaulted: false,
      isCorporate: false,
      holders: [],
      publicFloat: 0,
      corporationId: new ObjectId(),
    };

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      // After maturity, no active bonds remain
      const cursor = makeCursor([]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.bondHistorySnapshots).toBe(0);
    expect(db.collectionMocks["bondHistory"]!.insertMany).not.toHaveBeenCalled();
  });

  // ── Default-ordering bug regression tests ────────────────────────────────
  // Pre-fix order: deduct issuer coupon costs (Phase 2) → check default
  // (Phase 3) → credit holder coupon income (Phase 6). A corp that issued
  // small coupons but received large coupons could be incorrectly defaulted
  // when its income would have covered the cost. Costco (corp 170) on T478
  // is the production manifestation. These tests pin the post-fix invariant:
  // the default check uses NET coupon + maturity flow, not just outflows.
  //
  // To test production logic genuinely (rather than asserting the answers we
  // hand-fed to the find mock), the helper below stitches a stateful
  // liquidCapital simulator on top of the static mock DB: bulkWrite +
  // updateOne $inc operations mutate per-corp balances, and subsequent
  // corporations.find calls reflect those mutations. This makes the default
  // check observe what the production code actually wrote.

  function installCorpBalanceSimulator(
    initial: Map<string, number>,
    otherFields: Record<string, Record<string, unknown>> = {}
  ) {
    const balances = new Map(initial);
    function snapshot(): Array<Record<string, unknown>> {
      return [...balances.entries()].map(([id, liquidCapital]) => ({
        _id: new ObjectId(id),
        liquidCapital,
        ...(otherFields[id] ?? {}),
      }));
    }
    db.collectionMocks["corporations"]!.find.mockImplementation(() => makeCursor(snapshot()));
    db.collectionMocks["corporations"]!.bulkWrite.mockImplementation(async (ops: any[]) => {
      for (const op of ops) {
        const id = op?.updateOne?.filter?._id?.toString();
        const inc = op?.updateOne?.update?.$inc?.liquidCapital;
        if (id && balances.has(id) && typeof inc === "number") {
          balances.set(id, balances.get(id)! + inc);
        }
      }
      return { modifiedCount: ops.length, matchedCount: ops.length };
    });
    db.collectionMocks["corporations"]!.updateOne.mockImplementation(
      async (filter: any, update: any) => {
        const id = filter?._id?.toString();
        const inc = update?.$inc?.liquidCapital;
        if (id && balances.has(id) && typeof inc === "number") {
          balances.set(id, balances.get(id)! + inc);
        }
        return { modifiedCount: 1, matchedCount: 1 };
      }
    );
    db.collectionMocks["corporations"]!.updateMany.mockResolvedValue({ modifiedCount: 0 });
    return balances;
  }

  it("does NOT default an issuer whose coupon income covers its coupon cost", async () => {
    // Target corp is BOTH issuer (5 units publicFloat → 50 ₳ coupon owed)
    // AND holder (50 units of someone else's bond → 500 ₳ coupon income).
    // Pre-turn liquidCapital is 2 — less than the gross coupon cost (50)
    // but well covered by net flow (+450). Pre-fix: -48 → DEFAULT. Post-fix
    // (income credited before default check): +452 → solvent.
    const targetCorpId = new ObjectId();
    const otherIssuerCorpId = new ObjectId();

    const issuedBond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [],
      publicFloat: 5,
      corporationId: targetCorpId,
    };
    const heldBond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [{ corporationId: targetCorpId, units: 50 }],
      publicFloat: 0,
      corporationId: otherIssuerCorpId,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([issuedBond, heldBond]);
      const cursor = makeCursor([
        { _id: issuedBond._id, marketPrice: 1.0 },
        { _id: heldBond._id, marketPrice: 1.0 },
      ]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    const balances = installCorpBalanceSimulator(
      new Map([
        [targetCorpId.toString(), 2],
        [otherIssuerCorpId.toString(), 1_000_000],
      ]),
      {
        [targetCorpId.toString()]: { countryId: "US" },
        [otherIssuerCorpId.toString()]: { countryId: "US" },
      }
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.bondsDefaulted).toBe(0);
    // Final liquidCapital reflects net (+450) plus the rounded coupon income.
    expect(balances.get(targetCorpId.toString())!).toBeGreaterThan(0);
    const bondBulkWrite = db.collectionMocks["bonds"]!.bulkWrite;
    const allBondOps = bondBulkWrite.mock.calls.flatMap((c: unknown[]) => c[0] as unknown[]);
    const defaultMark = allBondOps.find(
      (op: any) => op.updateOne?.update?.$set?.defaulted === true
    );
    expect(defaultMark).toBeUndefined();
  });

  it("does NOT default a holder corp whose maturity income covers its coupon cost", async () => {
    // Target corp owes a small coupon (50 ₳) on cash of 10. It holds a bond
    // maturing THIS TURN: 5 units × 1000 face = 5000 ₳ income inbound. Plus
    // 50 ₳ coupon income on the same bond. Pre-fix: maturity income lands
    // after the default check → DEFAULT. Post-fix: net (+5000) prevents it.
    const targetCorpId = new ObjectId();
    const otherIssuerCorpId = new ObjectId();

    const issuedBond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [],
      publicFloat: 5,
      corporationId: targetCorpId,
    };
    const heldBond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 10,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [{ corporationId: targetCorpId, units: 5 }],
      publicFloat: 0,
      corporationId: otherIssuerCorpId,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([issuedBond, heldBond]);
      const cursor = makeCursor([{ _id: issuedBond._id, marketPrice: 1.0 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    const balances = installCorpBalanceSimulator(
      new Map([
        [targetCorpId.toString(), 10],
        [otherIssuerCorpId.toString(), 1_000_000],
      ]),
      {
        [targetCorpId.toString()]: { countryId: "US" },
        [otherIssuerCorpId.toString()]: {
          countryId: "US",
          userId: new ObjectId(),
          name: "Issuer Inc",
        },
      }
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.bondsDefaulted).toBe(0);
    expect(result.bondsMatured).toBe(1);
    expect(balances.get(targetCorpId.toString())!).toBeGreaterThan(0);
  });

  it("DOES default an issuer whose own bond maturity face value pushes net flow negative", async () => {
    // Target corp owes a small coupon (50 ₳) and has a bond maturing THIS
    // TURN with 5 units × 1000 = 5000 ₳ face value owed. Cash 100. Net flow
    // = -50 (coupon) - 50 (maturity coupon) - 5000 (maturity face) = -5100;
    // projected balance -5000 → MUST DEFAULT. Pre-fix: Phase 2 only deducts
    // 100 ₳ coupon → balance 0 → no default; then Phase 5 silently debits
    // 5000 face value → -5000 with no default check after.
    const issuerCorpId = new ObjectId();
    const couponBond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [],
      publicFloat: 5,
      corporationId: issuerCorpId,
    };
    const maturingBond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 10,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [],
      publicFloat: 5,
      corporationId: issuerCorpId,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([couponBond, maturingBond]);
      const cursor = makeCursor([]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    installCorpBalanceSimulator(new Map([[issuerCorpId.toString(), 100]]), {
      [issuerCorpId.toString()]: {
        countryId: "US",
        userId: new ObjectId(),
        name: "Doomed Corp",
        sequentialId: 1,
      },
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    // Both bonds belong to the defaulted issuer; the maturing bond is marked
    // defaulted instead of matured (existing Phase 4 semantics — defaultedCorps
    // wins over isMatured).
    expect(result.bondsDefaulted).toBeGreaterThanOrEqual(1);
    expect(result.bondsMatured).toBe(0);
  });

  it("cascades default to a holder corp whose solvency depended on a defaulting issuer's maturity", async () => {
    // Two issuers:
    //  - B issues bondY (maturing this turn). B has no cash → defaults on its
    //    own coupon + maturity obligation.
    //  - A issues bondZ (regular coupon, not maturing). A holds 4 units of
    //    bondY, expecting 4000 ₳ maturity income. A's coupon obligation on
    //    bondZ is 1000 ₳; cash 100. With B's maturity income, A's projected
    //    balance is positive (3140). But B defaults → maturity is rolled back
    //    in Phase 3.5 → A's actual balance becomes -860. Without cascade
    //    handling A would silently sit underwater. With cascade, A defaults
    //    too and bondZ is marked defaulted.
    const issuerBId = new ObjectId();
    const issuerAId = new ObjectId();
    const bondY = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 10, // matures THIS TURN
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [{ corporationId: issuerAId, units: 4 }],
      publicFloat: 5,
      corporationId: issuerBId,
    };
    const bondZ = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [],
      publicFloat: 100, // A owes 100 × 10 = 1000 ₳ coupon
      corporationId: issuerAId,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bondY, bondZ]);
      const cursor = makeCursor([{ _id: bondZ._id, marketPrice: 0.5 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    installCorpBalanceSimulator(
      new Map([
        [issuerBId.toString(), 0],
        [issuerAId.toString(), 100],
      ]),
      {
        [issuerBId.toString()]: { countryId: "US" },
        [issuerAId.toString()]: { countryId: "US" },
      }
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    // Both bondY (B's, primary default) AND bondZ (A's, cascaded default)
    // should be marked defaulted. bondY's matured-into-defaulted transition
    // counts as one of the bondsDefaulted; bondZ becomes defaulted from A's
    // cascade.
    expect(result.bondsDefaulted).toBeGreaterThanOrEqual(2);

    // Bond bulkWrite should mark BOTH bonds defaulted
    const bondBulkWrite = db.collectionMocks["bonds"]!.bulkWrite;
    const allBondOps = bondBulkWrite.mock.calls.flatMap((c: unknown[]) => c[0] as unknown[]);
    const defaultedBondIds = allBondOps
      .filter((op: any) => op.updateOne?.update?.$set?.defaulted === true)
      .map((op: any) => op.updateOne.filter._id.toString());
    expect(defaultedBondIds).toContain(bondY._id.toString());
    expect(defaultedBondIds).toContain(bondZ._id.toString());
  });

  it("cascades default through three levels (A defaults → B → C)", async () => {
    // Three issuers. C issues bondYC (matures this turn) — C has no cash and
    // big maturity obligation → defaults. B holds bondYC for face-value income
    // it relies on to cover its own coupon — clawback when C defaults pushes
    // B underwater → cascade. A holds B's maturing bondYB for the same kind
    // of dependency — second clawback push A underwater. Each cascading corp
    // also issues a non-maturing bond Z to verify the issuer's bond gets
    // marked defaulted.
    const idC = new ObjectId();
    const idB = new ObjectId();
    const idA = new ObjectId();

    const bondYC = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 10,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [{ corporationId: idB, units: 4 }],
      publicFloat: 5,
      corporationId: idC,
    };
    const bondYB = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 10,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [{ corporationId: idA, units: 4 }],
      publicFloat: 5,
      corporationId: idB,
    };
    const bondZA = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [],
      publicFloat: 100, // A's coupon obligation
      corporationId: idA,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bondYC, bondYB, bondZA]);
      const cursor = makeCursor([{ _id: bondZA._id, marketPrice: 0.5 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    installCorpBalanceSimulator(
      new Map([
        [idC.toString(), 0],
        [idB.toString(), 100],
        [idA.toString(), 100],
      ]),
      {
        [idC.toString()]: { countryId: "US" },
        [idB.toString()]: { countryId: "US" },
        [idA.toString()]: { countryId: "US" },
      }
    );
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    // All three bonds should be marked defaulted (C's matured-into-defaulted,
    // B's matured-into-defaulted via cascade, A's regular bond via cascade).
    expect(result.bondsDefaulted).toBeGreaterThanOrEqual(3);
    const bondBulkWrite = db.collectionMocks["bonds"]!.bulkWrite;
    const allBondOps = bondBulkWrite.mock.calls.flatMap((c: unknown[]) => c[0] as unknown[]);
    const defaultedBondIds = new Set(
      allBondOps
        .filter((op: any) => op.updateOne?.update?.$set?.defaulted === true)
        .map((op: any) => op.updateOne.filter._id.toString())
    );
    expect(defaultedBondIds.has(bondYC._id.toString())).toBe(true);
    expect(defaultedBondIds.has(bondYB._id.toString())).toBe(true);
    expect(defaultedBondIds.has(bondZA._id.toString())).toBe(true);
  });

  it("credits a corp holder of a maturing sovereign bond before the default check", async () => {
    // Sovereign bond maturing this turn, held by a corp. The corp also owes
    // a small coupon on its own issued bond. Without the maturity income the
    // corp would default; with it (credited in Phase 2 alongside coupons),
    // the corp survives. Sovereign issuer has no corp default exposure so
    // there's no rollback risk.
    const sovereignBondId = new ObjectId();
    const issuerCorpId = new ObjectId();
    const govPlaceholderId = new ObjectId(); // sovereign bonds still carry a corporationId

    const sovereignBond = {
      _id: sovereignBondId,
      couponRate: 5,
      maturityTurn: 10,
      matured: false,
      defaulted: false,
      isCorporate: false, // SOVEREIGN
      countryId: "US",
      holders: [{ corporationId: issuerCorpId, units: 5 }], // 5 × 1000 = 5000 ₳ face
      publicFloat: 0,
      corporationId: govPlaceholderId,
    };
    const issuedBond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [],
      publicFloat: 5, // 50 ₳ coupon owed
      corporationId: issuerCorpId,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockImplementation((b: any) => !!b.isCorporate);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([sovereignBond, issuedBond]);
      const cursor = makeCursor([{ _id: issuedBond._id, marketPrice: 1.0 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    const balances = installCorpBalanceSimulator(new Map([[issuerCorpId.toString(), 10]]), {
      [issuerCorpId.toString()]: { countryId: "US" },
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.bondsDefaulted).toBe(0);
    expect(result.bondsMatured).toBe(1);
    // 10 + 50 (coupon Y) + 5000 (maturity Y) - 50 (coupon Z) = 5010
    expect(balances.get(issuerCorpId.toString())!).toBeGreaterThan(0);
  });

  it("regression: pure issuer with no bond income still defaults when underwater", async () => {
    // Guard against the fix suppressing legitimate defaults. Corp owes
    // coupons (100 ₳), holds nothing, has 5 cash → must still default.
    const issuerCorpId = new ObjectId();
    const bond = {
      _id: new ObjectId(),
      couponRate: 5,
      maturityTurn: 100,
      matured: false,
      defaulted: false,
      isCorporate: true,
      holders: [],
      publicFloat: 10,
      corporationId: issuerCorpId,
    };

    const { isCorporateBond } = await import("@/lib/bonds/sovereign");
    vi.mocked(isCorporateBond).mockReturnValue(true);

    let bondFindCount = 0;
    db.collectionMocks["bonds"]!.find.mockImplementation(() => {
      bondFindCount++;
      if (bondFindCount === 1) return makeCursor([bond]);
      const cursor = makeCursor([{ _id: bond._id, marketPrice: 0.5 }]);
      cursor.project = vi.fn().mockReturnValue(cursor);
      return cursor;
    });
    installCorpBalanceSimulator(new Map([[issuerCorpId.toString(), 5]]), {
      [issuerCorpId.toString()]: { countryId: "US" },
    });
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 2.75 }])
    );
    db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processBondTurn } = await import("./bondTurn");
    const result = await processBondTurn(10);

    expect(result.bondsDefaulted).toBe(1);
  });

  describe("Phase 7 auto-resolution ordering (refinance → restructure → stand)", () => {
    function installLingeringDefault(corp: { _id: ObjectId; name: string; userId: ObjectId }) {
      const activeBond = {
        _id: new ObjectId(),
        couponRate: 5,
        maturityTurn: 100,
        matured: false,
        defaulted: false,
        holders: [],
        publicFloat: 0,
        corporationId: new ObjectId(),
      };
      let bondFindCount = 0;
      db.collectionMocks["bonds"]!.find.mockImplementation(() => {
        bondFindCount++;
        if (bondFindCount === 1) return makeCursor([activeBond]);
        const cursor = makeCursor([]);
        cursor.project = vi.fn().mockReturnValue(cursor);
        return cursor;
      });
      db.collectionMocks["centralBanks"]!.find.mockReturnValue(
        makeCursor([{ countryId: "US", primeRate: 2.75 }])
      );
      db.collectionMocks["bondHistory"]!.aggregate.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      });
      // Lingering-default corp for Phase 7.
      db.collectionMocks["bonds"]!.distinct.mockResolvedValue([corp._id]);
      db.collectionMocks["corporations"]!.find.mockReturnValue(makeCursor([corp]));
    }

    it("prefers refinance (no sector sale) when the corp can refinance", async () => {
      const corp = { _id: new ObjectId(), name: "AutoRefi Co", userId: new ObjectId() };
      const { isCorporateBond } = await import("@/lib/bonds/sovereign");
      vi.mocked(isCorporateBond).mockReturnValue(false);
      installLingeringDefault(corp);

      const { executeCorporationBondRefinance } =
        await import("@/lib/bonds/executeCorporationBondRefinance");
      vi.mocked(executeCorporationBondRefinance).mockResolvedValue({
        ok: true,
        bondId: "newbond",
        faceValueAnchor: 1_000_000,
        couponRate: 6.5,
        maturityTurn: 106,
        retiredBondIds: ["old1", "old2"],
        bondsMatured: 2,
      });
      const { executeCorporationBondRestructure } =
        await import("@/lib/bonds/executeCorporationBondRestructure");
      const { createNotifications } = await import("@/lib/notifications");

      const { processBondTurn } = await import("./bondTurn");
      const result = await processBondTurn(10);

      expect(result.bondsAutoRefinanced).toBe(2);
      expect(result.bondsAutoRestructured).toBe(0);
      // Restructure (the sector-sale path) is never reached when refinance succeeds.
      expect(vi.mocked(executeCorporationBondRestructure)).not.toHaveBeenCalled();
      // CEO notified with the refinance notification type (ticket #900 tracking).
      const notifs = vi
        .mocked(createNotifications)
        .mock.calls.flatMap((c) => c[0] as { type: string }[]);
      expect(notifs.some((n) => n.type === "corp_bond_auto_refinanced")).toBe(true);
      // Audit row written to adminLogs.
      const auditRows = db.collectionMocks["adminLogs"]!.insertMany.mock.calls.flatMap(
        (c) => c[0] as { method: string }[]
      );
      expect(auditRows.some((r) => r.method === "refinance")).toBe(true);
    });

    it("falls back to restructure (sector sale) when refinance is infeasible", async () => {
      const corp = { _id: new ObjectId(), name: "SellSectors Co", userId: new ObjectId() };
      const { isCorporateBond } = await import("@/lib/bonds/sovereign");
      vi.mocked(isCorporateBond).mockReturnValue(false);
      installLingeringDefault(corp);

      const { executeCorporationBondRefinance } =
        await import("@/lib/bonds/executeCorporationBondRefinance");
      vi.mocked(executeCorporationBondRefinance).mockResolvedValue({
        ok: false,
        reason: "Cannot refinance within debt limits",
      });
      const { executeCorporationBondRestructure } =
        await import("@/lib/bonds/executeCorporationBondRestructure");
      vi.mocked(executeCorporationBondRestructure).mockResolvedValue({
        paid: 1_000,
        bondsMatured: 1,
        sectorsLiquidated: 1,
        proceeds: 1_500,
        residualLiquidCapital: 500,
      });
      const { createNotifications } = await import("@/lib/notifications");

      const { processBondTurn } = await import("./bondTurn");
      const result = await processBondTurn(10);

      expect(vi.mocked(executeCorporationBondRestructure)).toHaveBeenCalledTimes(1);
      expect(result.bondsAutoRestructured).toBe(1);
      expect(result.bondsAutoRefinanced).toBe(0);
      // CEO notified about the forced sector sale (the notification whose absence caused #900).
      const notifs = vi
        .mocked(createNotifications)
        .mock.calls.flatMap((c) => c[0] as { type: string }[]);
      expect(notifs.some((n) => n.type === "corp_bond_auto_restructured")).toBe(true);
      const auditRows = db.collectionMocks["adminLogs"]!.insertMany.mock.calls.flatMap(
        (c) => c[0] as { method: string }[]
      );
      expect(auditRows.some((r) => r.method === "restructure")).toBe(true);
    });
  });
});
