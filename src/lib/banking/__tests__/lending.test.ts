import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { BankCharter } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import { estimatePerTurnCurrencyIncomeHomeFace } from "@/lib/lineOfCredit/currencyIncomeEstimate";
import {
  CHARACTER_LOAN_SPREAD_PP,
  NPC_LOAN_BOOK_DEFAULT_MAX_PERCENT,
  NPC_LOAN_BOOK_DEFAULT_MIN_PERCENT,
  NPC_LOAN_BOOK_VOLUME_FACTOR_MAX,
  NPC_LOAN_BOOK_VOLUME_FACTOR_MIN,
  applyLoanPayment,
  computeNpcLoanBook,
  markLoanDefaulted,
} from "../lending";
import {
  RESERVE_REQUIREMENT_HISTORICAL_DEFAULT,
  RESERVE_REQUIREMENT_MODERN_DEFAULT,
  getLendableHeadroom,
} from "../reserves";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/lineOfCredit/currencyIncomeEstimate", () => ({
  estimatePerTurnCurrencyIncomeHomeFace: vi.fn().mockResolvedValue(1_000_000),
}));

function makeActiveRetailCharter(overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 10_000_000,
    cashReserves: 10_000_000,
    depositOffset: 0,
    lendingOffset: 1,
    npcDeposits: 1_000_000,
    totalLoans: 0,
    blacklist: {},
    ...overrides,
  };
}

function makeBankCorp(charter: BankCharter, overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    name: "Test Bank",
    type: "financial",
    liquidCapital: 50_000_000,
    liquidCurrencyCode: "USD",
    countryId: "US",
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    headquartersState: "CA",
    bankCharter: charter,
    ...overrides,
  } as unknown as Corporation;
}

describe("banking lending", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("gameConfig");
    db.collection("gameState");
    db.collection("centralBanks");
    db.collection("corporations");
    db.collection("characters");
    db.collection("bankLoans");
    db.collection("indexFunds");
    db.collection("corporationHistory");
    db.collection("exchangeRates");
    db.collectionMocks.corporationHistory!.find().toArray.mockResolvedValue([{ income: 500_000 }]);
    vi.mocked(estimatePerTurnCurrencyIncomeHomeFace).mockResolvedValue(1_000_000);

    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
    });
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "2019-default",
      currentTurn: 42,
    });
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      primeRate: 5,
    });
  });

  async function importLending() {
    return import("../lending");
  }

  async function importReserves() {
    return import("../reserves");
  }

  describe("getLendableHeadroom", () => {
    it("is deposits * (1 - reserve) minus outstanding loans, floored at 0", () => {
      expect(getLendableHeadroom({ npcDeposits: 1_000_000, totalLoans: 100_000 }, 0.1)).toBe(
        800_000
      );
      expect(getLendableHeadroom({ npcDeposits: 100_000, totalLoans: 95_000 }, 0.2)).toBe(0);
      expect(getLendableHeadroom({}, 0.1)).toBe(0);
    });
  });

  describe("getReserveRequirement era defaults", () => {
    it("defaults to 0.10 in a modern world when CB field is absent", async () => {
      const { getReserveRequirement } = await importReserves();
      await expect(getReserveRequirement(db as unknown as Db, "USD")).resolves.toBe(
        RESERVE_REQUIREMENT_MODERN_DEFAULT
      );
    });

    it("defaults to 0.20 in a historical world when CB field is absent", async () => {
      db.collectionMocks.gameState!.findOne.mockResolvedValue({
        _id: "current",
        preset: "1953-default",
        currentTurn: 1,
      });
      const { getReserveRequirement } = await importReserves();
      await expect(getReserveRequirement(db as unknown as Db, "USD")).resolves.toBe(
        RESERVE_REQUIREMENT_HISTORICAL_DEFAULT
      );
    });

    it("uses the stored CB bankReserveRequirement when present", async () => {
      db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
        _id: "US",
        primeRate: 5,
        bankReserveRequirement: 0.15,
      });
      const { getReserveRequirement } = await importReserves();
      await expect(getReserveRequirement(db as unknown as Db, "USD")).resolves.toBe(0.15);
    });
  });

  describe("originateLoan rejects", () => {
    it("rejects when private banking is off", async () => {
      db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
        _id: "default",
        privateBankingEnabled: false,
      });
      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        new ObjectId(),
        { type: "character", id: new ObjectId() },
        1_000,
        12
      );
      expect(result).toEqual({ ok: false, error: "Private banking is not enabled" });
    });

    it("rejects an investment charter lending to an INDIVIDUAL (firms are allowed)", async () => {
      const bankId = new ObjectId();
      db.collectionMocks.corporations!.findOne.mockResolvedValue(
        makeBankCorp(makeActiveRetailCharter({ type: "investment" }), { _id: bankId })
      );
      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        bankId,
        { type: "character", id: new ObjectId() },
        1_000,
        12
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/lends to corporations, not to individuals/i);
      }
    });

    it("rejects a blacklisted character borrower", async () => {
      const bankId = new ObjectId();
      const characterId = new ObjectId();
      db.collectionMocks.corporations!.findOne.mockResolvedValue(
        makeBankCorp(
          makeActiveRetailCharter({
            blacklist: { characterIds: [characterId.toString()] },
          }),
          { _id: bankId }
        )
      );
      db.collectionMocks.characters!.findOne.mockResolvedValue({
        _id: characterId,
        currencyBalances: { personal: { USD: 1_000_000 } },
      });
      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        bankId,
        { type: "character", id: characterId },
        1_000,
        12
      );
      expect(result).toEqual({ ok: false, error: "Borrower is on the bank's blacklist" });
    });

    it("rejects a corporation blocked via index-fund constituency", async () => {
      const bankId = new ObjectId();
      const borrowerCorpId = new ObjectId();
      db.collectionMocks.corporations!.findOne.mockImplementation(
        async (query: { _id: ObjectId }) => {
          if (query._id.equals(bankId)) {
            return makeBankCorp(
              makeActiveRetailCharter({
                blacklist: { indexFundIds: ["us_top_25"] },
                npcDeposits: 10_000_000,
              }),
              { _id: bankId }
            );
          }
          return {
            _id: borrowerCorpId,
            liquidCapital: 5_000_000,
            liquidCurrencyCode: "USD",
            countryId: "US",
          };
        }
      );
      db.collectionMocks.indexFunds!.find.mockReturnValue({
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          {
            slug: "us_top_25",
            targetConstituents: [{ corporationId: borrowerCorpId, targetWeight: 1 }],
          },
        ]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
      });

      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        bankId,
        { type: "corporation", id: borrowerCorpId },
        1_000,
        12
      );
      expect(result).toEqual({ ok: false, error: "Borrower is on the bank's blacklist" });
    });

    it("rejects principal over lendable headroom", async () => {
      const bankId = new ObjectId();
      const characterId = new ObjectId();
      // headroom at 10% reserve: 1_000_000 * 0.9 - 800_000 = 100_000
      db.collectionMocks.corporations!.findOne.mockResolvedValue(
        makeBankCorp(makeActiveRetailCharter({ npcDeposits: 1_000_000, totalLoans: 800_000 }), {
          _id: bankId,
        })
      );
      db.collectionMocks.characters!.findOne.mockResolvedValue({
        _id: characterId,
        countryId: "US",
        currencyBalances: { personal: { USD: 10_000_000 } },
      });
      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        bankId,
        { type: "character", id: characterId },
        100_001,
        12
      );
      expect(result).toEqual({
        ok: false,
        error: "Principal exceeds lendable headroom (max 100000)",
      });
    });

    it("rejects principal over the bank's cash reserves, not the holding company's LC", async () => {
      const bankId = new ObjectId();
      const characterId = new ObjectId();
      db.collectionMocks.corporations!.findOne.mockResolvedValue(
        makeBankCorp(
          makeActiveRetailCharter({
            npcDeposits: 10_000_000,
            cashReserves: 4_000,
          }),
          { _id: bankId, liquidCapital: 50_000_000 }
        )
      );
      db.collectionMocks.characters!.findOne.mockResolvedValue({
        _id: characterId,
        countryId: "US",
        currencyBalances: { personal: { USD: 10 } },
      });
      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        bankId,
        { type: "character", id: characterId },
        4_001,
        12
      );
      expect(result).toEqual({
        ok: false,
        error: "Principal exceeds the bank's cash reserves (max 4000)",
      });
    });

    it("rejects principal over the borrower income limit", async () => {
      const bankId = new ObjectId();
      const characterId = new ObjectId();
      vi.mocked(estimatePerTurnCurrencyIncomeHomeFace).mockResolvedValue(100);
      db.collectionMocks.corporations!.findOne.mockResolvedValue(
        makeBankCorp(makeActiveRetailCharter({ npcDeposits: 10_000_000 }), { _id: bankId })
      );
      db.collectionMocks.characters!.findOne.mockResolvedValue({
        _id: characterId,
        countryId: "US",
        currencyBalances: { personal: { USD: 10 } },
      });
      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        bankId,
        { type: "character", id: characterId },
        50_000,
        12
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/Principal exceeds borrower income limit \(max \d+\)/);
      }
    });

    it("rejects corporation borrower when treasury currency mismatches loan currency", async () => {
      const bankId = new ObjectId();
      const borrowerCorpId = new ObjectId();
      db.collectionMocks.corporations!.findOne.mockImplementation(
        async (query: { _id: ObjectId }) => {
          if (query._id.equals(bankId)) {
            return makeBankCorp(
              makeActiveRetailCharter({ currency: "USD", npcDeposits: 10_000_000 }),
              { _id: bankId }
            );
          }
          return {
            _id: borrowerCorpId,
            liquidCapital: 5_000_000,
            liquidCurrencyCode: "GBP",
            countryId: "UK",
          };
        }
      );

      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        bankId,
        { type: "corporation", id: borrowerCorpId },
        1_000,
        12
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/does not match corporation treasury currency/i);
      }
    });
  });

  describe("originateLoan success and compensation", () => {
    it("lets an investment charter disburse a named corporation loan", async () => {
      const bankId = new ObjectId();
      const borrowerCorpId = new ObjectId();
      const charter = makeActiveRetailCharter({
        type: "investment",
        npcDeposits: 0,
        cashReserves: 1_000_000,
        totalLoans: 0,
      });
      db.collectionMocks.corporations!.findOne.mockImplementation(
        async (query: { _id: ObjectId }) =>
          query._id.equals(bankId)
            ? makeBankCorp(charter, { _id: bankId })
            : ({
                _id: borrowerCorpId,
                name: "Borrower Corp",
                liquidCapital: 50_000,
                liquidCurrencyCode: "USD",
                countryId: "US",
              } as Corporation)
      );
      db.collectionMocks.bankLoans!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
      db.collectionMocks.corporations!.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });

      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        bankId,
        { type: "corporation", id: borrowerCorpId },
        25_000,
        24
      );

      expect(result.ok).toBe(true);
      const [bankFilter] = db.collectionMocks.corporations!.updateOne.mock.calls[0];
      expect(bankFilter["bankCharter.type"]).toEqual({
        $in: ["retail", "investment", "universal"],
      });
    });

    it("credits borrower, writes outstanding, and $inc's totalLoans by the same principal", async () => {
      const bankId = new ObjectId();
      const characterId = new ObjectId();
      const principal = 25_000;
      const charter = makeActiveRetailCharter({
        npcDeposits: 1_000_000,
        totalLoans: 0,
        lendingOffset: 1,
      });

      db.collectionMocks.corporations!.findOne.mockResolvedValue(
        makeBankCorp(charter, { _id: bankId })
      );
      db.collectionMocks.characters!.findOne.mockResolvedValue({
        _id: characterId,
        currencyBalances: { personal: { USD: 200_000 } },
      });
      db.collectionMocks.bankLoans!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
      db.collectionMocks.corporations!.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });
      db.collectionMocks.characters!.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });

      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        bankId,
        { type: "character", id: characterId },
        principal,
        24
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.loan.principal).toBe(principal);
      expect(result.loan.outstanding).toBe(principal);
      expect(result.loan.status).toBe("current");
      expect(result.loan.termTurns).toBe(24);
      expect(result.creditedTo).toEqual({ kind: "character", name: "Borrower" });
      // prime 5 + lendingOffset 1 + character spread 1.5
      expect(result.loan.ratePercent).toBe(5 + 1 + CHARACTER_LOAN_SPREAD_PP);

      const [loanDoc] = db.collectionMocks.bankLoans!.insertOne.mock.calls[0];
      expect(loanDoc.outstanding).toBe(principal);
      expect(loanDoc.principal).toBe(principal);

      const [, bankUpdate] = db.collectionMocks.corporations!.updateOne.mock.calls[0];
      expect(bankUpdate.$inc["bankCharter.totalLoans"]).toBe(principal);

      const [, charUpdate] = db.collectionMocks.characters!.updateOne.mock.calls[0];
      expect(charUpdate.$inc["currencyBalances.personal.USD"]).toBe(principal);

      expect(principal).toBe(result.loan.outstanding);
      expect(bankUpdate.$inc["bankCharter.totalLoans"]).toBe(
        charUpdate.$inc["currencyBalances.personal.USD"]
      );
    });

    it("parks a loan as pending with no money movement when the bank requires approval", async () => {
      const bankId = new ObjectId();
      const characterId = new ObjectId();
      const principal = 25_000;
      const charter = makeActiveRetailCharter({
        npcDeposits: 1_000_000,
        totalLoans: 0,
        requireApproval: true,
      });

      db.collectionMocks.corporations!.findOne.mockResolvedValue(
        makeBankCorp(charter, { _id: bankId })
      );
      db.collectionMocks.characters!.findOne.mockResolvedValue({
        _id: characterId,
        currencyBalances: { personal: { USD: 200_000 } },
      });
      db.collectionMocks.bankLoans!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        bankId,
        { type: "character", id: characterId },
        principal,
        24
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.pending).toBe(true);
      expect(result.loan.status).toBe("pending");
      expect(result.loan.outstanding).toBe(principal);

      const [loanDoc] = db.collectionMocks.bankLoans!.insertOne.mock.calls[0];
      expect(loanDoc.status).toBe("pending");
      expect(loanDoc.requestedTurn).toBe(42);

      // No disbursement: the bank loan book is not incremented and the borrower
      // is not credited until the CEO accepts.
      expect(db.collectionMocks.corporations!.updateOne).not.toHaveBeenCalled();
      expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    });

    it("ledgers the origination as a MINT, not as a transfer from the bank", async () => {
      // Lending creates deposit money: the bank's own liquidCapital is untouched
      // and only its loan book moves. Naming the bank as counterparty would book
      // a cash outflow that never happened.
      const { emitTx } = await import("@/lib/financialTxLog/emit");
      vi.mocked(emitTx).mockClear();

      const bankId = new ObjectId();
      const characterId = new ObjectId();
      const principal = 25_000;

      db.collectionMocks.corporations!.findOne.mockResolvedValue(
        makeBankCorp(makeActiveRetailCharter({ npcDeposits: 1_000_000, totalLoans: 0 }), {
          _id: bankId,
          name: "First National",
        })
      );
      db.collectionMocks.characters!.findOne.mockResolvedValue({
        _id: characterId,
        name: "Borrower One",
        currencyBalances: { personal: { USD: 200_000 } },
      });
      db.collectionMocks.bankLoans!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
      db.collectionMocks.corporations!.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });
      db.collectionMocks.characters!.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });

      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        bankId,
        { type: "character", id: characterId },
        principal,
        24
      );
      expect(result.ok).toBe(true);

      expect(emitTx).toHaveBeenCalledTimes(1);
      const [, entry] = vi.mocked(emitTx).mock.calls[0]!;
      expect(entry).toMatchObject({
        type: "bank_loan_origination",
        subjectType: "character",
        subjectId: characterId,
        subjectName: "Borrower One",
        amount: principal,
        currencyCode: "USD",
        // system, so the row derives a mint contra rather than a bank debit.
        counterpartyType: "system",
      });
      expect((entry as { counterpartyId?: unknown }).counterpartyId).toBeUndefined();
    });

    it("emits no ledger leg when origination fails", async () => {
      const { emitTx } = await import("@/lib/financialTxLog/emit");
      vi.mocked(emitTx).mockClear();

      db.collectionMocks.corporations!.findOne.mockResolvedValue(null);
      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        new ObjectId(),
        { type: "character", id: new ObjectId() },
        1000,
        24
      );

      expect(result.ok).toBe(false);
      expect(emitTx).not.toHaveBeenCalled();
    });

    it("credits corporation liquidCapital at the posted rate (no character spread)", async () => {
      const bankId = new ObjectId();
      const borrowerCorpId = new ObjectId();
      const principal = 40_000;

      db.collectionMocks.corporations!.findOne.mockImplementation(
        async (query: { _id: ObjectId }) => {
          if (query._id.equals(bankId)) {
            return makeBankCorp(
              makeActiveRetailCharter({ npcDeposits: 1_000_000, lendingOffset: 1 }),
              { _id: bankId }
            );
          }
          return {
            _id: borrowerCorpId,
            name: "Hunt Oil Company",
            liquidCapital: 1_000,
            liquidCurrencyCode: "USD",
            countryId: "US",
          };
        }
      );
      db.collectionMocks.bankLoans!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
      db.collectionMocks.corporations!.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });

      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        bankId,
        { type: "corporation", id: borrowerCorpId },
        principal,
        12
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.loan.ratePercent).toBe(6); // prime 5 + offset 1, no character spread
      expect(result.creditedTo).toEqual({ kind: "corporation", name: "Hunt Oil Company" });

      // First updateOne is bank totalLoans; second is borrower liquidCapital.
      const borrowerUpdate = db.collectionMocks.corporations!.updateOne.mock.calls[1][1];
      expect(borrowerUpdate.$inc.liquidCapital).toBe(principal);
    });

    it("deletes the loan doc when the credit step fails", async () => {
      const bankId = new ObjectId();
      const characterId = new ObjectId();
      const principal = 10_000;

      db.collectionMocks.corporations!.findOne.mockResolvedValue(
        makeBankCorp(makeActiveRetailCharter({ npcDeposits: 1_000_000 }), { _id: bankId })
      );
      db.collectionMocks.characters!.findOne.mockResolvedValue({
        _id: characterId,
        currencyBalances: { personal: { USD: 200_000 } },
      });
      db.collectionMocks.bankLoans!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
      db.collectionMocks.corporations!.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });
      db.collectionMocks.characters!.updateOne.mockResolvedValue({
        matchedCount: 0,
        modifiedCount: 0,
      });
      db.collectionMocks.bankLoans!.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const { originateLoan } = await importLending();
      const result = await originateLoan(
        db as unknown as Db,
        bankId,
        { type: "character", id: characterId },
        principal,
        12
      );

      expect(result).toEqual({ ok: false, error: "Failed to credit borrower" });
      expect(db.collectionMocks.bankLoans!.deleteOne).toHaveBeenCalled();
      const deleteFilter = db.collectionMocks.bankLoans!.deleteOne.mock.calls[0][0];
      const inserted = db.collectionMocks.bankLoans!.insertOne.mock.calls[0][0];
      expect(deleteFilter._id).toEqual(inserted._id);

      // Reverse the totalLoans $inc as part of compensation.
      const reverseUpdate = db.collectionMocks.corporations!.updateOne.mock.calls[1][1];
      expect(reverseUpdate.$inc["bankCharter.totalLoans"]).toBe(-principal);
    });
  });

  describe("computeNpcLoanBook", () => {
    it("uses lendable household deposits, never GDP, as its funding base", () => {
      // A new bank with $75M of lendable deposits may fill that capacity at a
      // normal loan rate. National GDP must not create an unfunded loan book.
      const book = computeNpcLoanBook(75_000_000, 4);

      expect(book.volume).toBe(75_000_000);
    });

    it("shrinks volume and raises default rate when lending rate rises", () => {
      const low = computeNpcLoanBook(1_000_000, 4);
      const high = computeNpcLoanBook(1_000_000, 10);
      expect(high.volume).toBeLessThan(low.volume);
      expect(high.expectedDefaultRatePercent).toBeGreaterThan(low.expectedDefaultRatePercent);
    });

    it("holds volume and default-rate bounds at extremes", () => {
      const cases = [-50, 0, 4, 6, 50, 200];
      for (const rate of cases) {
        const book = computeNpcLoanBook(1_000_000, rate);
        const factor = book.volume / 1_000_000;
        expect(factor).toBeGreaterThanOrEqual(NPC_LOAN_BOOK_VOLUME_FACTOR_MIN - 1e-12);
        expect(factor).toBeLessThanOrEqual(NPC_LOAN_BOOK_VOLUME_FACTOR_MAX + 1e-12);
        expect(book.expectedDefaultRatePercent).toBeGreaterThanOrEqual(
          NPC_LOAN_BOOK_DEFAULT_MIN_PERCENT
        );
        expect(book.expectedDefaultRatePercent).toBeLessThanOrEqual(
          NPC_LOAN_BOOK_DEFAULT_MAX_PERCENT
        );
      }
    });
  });

  describe("listBorrowerFacingLoans", () => {
    it("returns open character and CEO-corp loans with the credit destination", async () => {
      const characterId = new ObjectId();
      const corpId = new ObjectId();
      const bankId = new ObjectId();
      const characterLoanId = new ObjectId();
      const corpLoanId = new ObjectId();

      db.collectionMocks.bankLoans!.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          {
            _id: characterLoanId,
            bankCorporationId: bankId,
            currency: "USD",
            borrowerType: "character",
            borrowerId: characterId,
            principal: 10_000,
            outstanding: 9_000,
            ratePercent: 7.5,
            originatedTurn: 110,
            termTurns: 12,
            status: "current",
          },
          {
            _id: corpLoanId,
            bankCorporationId: bankId,
            currency: "USD",
            borrowerType: "corporation",
            borrowerId: corpId,
            principal: 1_000_000,
            outstanding: 988_000,
            ratePercent: 6,
            originatedTurn: 110,
            termTurns: 12,
            status: "current",
          },
        ]),
      });
      db.collectionMocks.corporations!.find.mockReturnValue({
        project: vi.fn().mockReturnThis(),
        toArray: vi
          .fn()
          .mockResolvedValue([{ _id: bankId, name: "Hagemeyer Holding", sequentialId: 559 }]),
      });

      const { listBorrowerFacingLoans } = await importLending();
      const rows = await listBorrowerFacingLoans(db as unknown as Db, {
        characterId,
        characterName: "H. L. Hunt",
        corporations: [{ id: corpId, name: "Hunt Oil Company" }],
      });

      const query = db.collectionMocks.bankLoans!.find.mock.calls[0][0];
      expect(query.status).toEqual({ $in: ["current", "arrears", "defaulted"] });

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        id: characterLoanId.toString(),
        bankName: "Hagemeyer Holding",
        borrowerType: "character",
        borrowerId: characterId.toString(),
        borrowerName: "H. L. Hunt",
        creditedTo: "personalCash",
        outstanding: 9_000,
      });
      expect(rows[1]).toMatchObject({
        id: corpLoanId.toString(),
        borrowerType: "corporation",
        borrowerId: corpId.toString(),
        borrowerName: "Hunt Oil Company",
        creditedTo: "corporationLiquidCapital",
        outstanding: 988_000,
      });
    });
  });

  describe("applyLoanPayment / markLoanDefaulted", () => {
    it("reduces outstanding and marks repaid at zero", () => {
      expect(applyLoanPayment({ outstanding: 100, status: "current" }, 40)).toEqual({
        outstanding: 60,
        status: "current",
      });
      expect(applyLoanPayment({ outstanding: 100, status: "current" }, 100)).toEqual({
        outstanding: 0,
        status: "repaid",
      });
    });

    it("marks defaulted without clearing outstanding", () => {
      expect(markLoanDefaulted({ outstanding: 250, status: "arrears" })).toEqual({
        outstanding: 250,
        status: "defaulted",
      });
    });
  });
});
