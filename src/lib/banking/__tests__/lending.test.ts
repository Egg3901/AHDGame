import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
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
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
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

  describe("originateLoan through the boundary and journal", () => {
    const BORROWER_CORP = new ObjectId();
    const BORROWER_CHAR = new ObjectId();

    function world(
      charterOverrides: Partial<BankCharter> = {},
      options: {
        historicalIncome?: number;
        privateBanking?: boolean;
        borrowerCurrency?: string;
      } = {}
    ) {
      const memory = createInMemoryDb();
      const bank = makeBankCorp(makeActiveRetailCharter(charterOverrides));
      memory.seed("gameConfig", [
        { _id: "default", privateBankingEnabled: options.privateBanking ?? true },
      ]);
      memory.seed("gameState", [{ _id: "current", currentTurn: 42, preset: "2019-default" }]);
      memory.seed("centralBanks", [
        { _id: "US", countryId: "US", primeRate: 5, bankReserveRequirement: 0.1 },
      ]);
      memory.seed("corporations", [
        bank as unknown as Record<string, unknown>,
        {
          _id: BORROWER_CORP,
          name: "Borrower Corp",
          type: "manufacturing",
          countryId: "US",
          liquidCapital: 250_000,
          liquidCurrencyCode: options.borrowerCurrency ?? "USD",
          userId: new ObjectId(),
        },
      ]);
      memory.seed("characters", [
        {
          _id: BORROWER_CHAR,
          name: "Borrower Person",
          countryId: "US",
          currencyBalances: { personal: { USD: 1_000 } },
        },
      ]);
      memory.seed(
        "corporationHistory",
        Array.from({ length: 12 }, (_, i) => ({
          _id: new ObjectId(),
          corporationId: BORROWER_CORP,
          turn: 31 + i,
          income: options.historicalIncome ?? 500_000,
        }))
      );
      return { memory, bank };
    }

    function bankDoc(memory: InMemoryDb, id: ObjectId) {
      return memory.collection("corporations").docs.find((d) => (d._id as ObjectId).equals(id)) as {
        liquidCapital: number;
        bankCharter: BankCharter;
      };
    }

    async function originate(
      memory: InMemoryDb,
      bank: Corporation,
      borrower: { type: "corporation" | "character"; id: ObjectId },
      principal: number,
      termTurns = 48
    ) {
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
      const { originateLoan } = await importLending();
      return originateLoan(memory as unknown as Db, bank._id, borrower, principal, termTurns);
    }

    it("rejects when private banking is off", async () => {
      const { memory, bank } = world({}, { privateBanking: false });
      const result = await originate(
        memory,
        bank,
        { type: "corporation", id: BORROWER_CORP },
        1_000
      );
      expect(result).toEqual({ ok: false, error: "Private banking is not enabled" });
      expect(memory.collection("bankLoans").docs).toHaveLength(0);
    });

    it("rejects an investment charter lending to an INDIVIDUAL (firms are allowed)", async () => {
      const { memory, bank } = world({ type: "investment", npcDeposits: 0, totalLoans: 0 });
      const person = await originate(memory, bank, { type: "character", id: BORROWER_CHAR }, 1_000);
      expect(person).toEqual({
        ok: false,
        error: "An investment charter lends to corporations, not to individuals",
      });
      const firm = await originate(memory, bank, { type: "corporation", id: BORROWER_CORP }, 1_000);
      expect(firm.ok).toBe(true);
    });

    it("rejects a blacklisted character borrower", async () => {
      const { memory, bank } = world({ blacklist: { characterIds: [BORROWER_CHAR.toString()] } });
      const result = await originate(memory, bank, { type: "character", id: BORROWER_CHAR }, 1_000);
      expect(result).toEqual({ ok: false, error: "Borrower is on the bank's blacklist" });
    });

    it("rejects a corporation blocked via index-fund constituency", async () => {
      const { memory, bank } = world({ blacklist: { indexFundIds: ["megafund"] } });
      memory.seed("indexFunds", [
        {
          _id: new ObjectId(),
          slug: "megafund",
          targetConstituents: [{ corporationId: BORROWER_CORP }],
        },
      ]);
      const result = await originate(
        memory,
        bank,
        { type: "corporation", id: BORROWER_CORP },
        1_000
      );
      expect(result).toEqual({ ok: false, error: "Borrower is on the bank's blacklist" });
    });

    it("rejects principal over lendable headroom and names the cap", async () => {
      // headroom = 1M x 0.9 - 0 = 900k; cash 10M does not bind.
      const { memory, bank } = world();
      const result = await originate(
        memory,
        bank,
        { type: "corporation", id: BORROWER_CORP },
        950_000
      );
      expect(result).toEqual({
        ok: false,
        error: "Principal exceeds lendable headroom (max 900000)",
      });
    });

    it("rejects principal over the bank's cash reserves, not the holding company's treasury", async () => {
      const { memory, bank } = world({ cashReserves: 100_000, npcDeposits: 5_000_000 });
      const result = await originate(
        memory,
        bank,
        { type: "corporation", id: BORROWER_CORP },
        200_000
      );
      expect(result).toEqual({
        ok: false,
        error: "Principal exceeds the bank's cash reserves (max 100000)",
      });
    });

    it("rejects principal over the borrower income limit", async () => {
      const { memory, bank } = world({}, { historicalIncome: 100 });
      const result = await originate(
        memory,
        bank,
        { type: "corporation", id: BORROWER_CORP },
        50_000
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/borrower income limit/);
    });

    it("rejects a corporation borrower whose treasury currency mismatches the loan", async () => {
      const { memory, bank } = world({}, { borrowerCurrency: "GBP" });
      const result = await originate(
        memory,
        bank,
        { type: "corporation", id: BORROWER_CORP },
        1_000
      );
      expect(result).toEqual({
        ok: false,
        error: "Loan currency USD does not match corporation treasury currency GBP",
      });
    });

    it("rejects a bank lending to itself and a bad term", async () => {
      const { memory, bank } = world();
      expect(await originate(memory, bank, { type: "corporation", id: bank._id }, 1_000)).toEqual({
        ok: false,
        error: "A bank cannot lend to itself",
      });
      expect(
        await originate(memory, bank, { type: "corporation", id: BORROWER_CORP }, 1_000, 3)
      ).toEqual({ ok: false, error: "termTurns must be an integer from 4 to 120" });
    });

    it("funds a corporation loan from the vault, credits the borrower, books the loan, once", async () => {
      const { memory, bank } = world();
      const before = bankDoc(memory, bank._id).bankCharter.cashReserves!;
      const result = await originate(
        memory,
        bank,
        { type: "corporation", id: BORROWER_CORP },
        100_000
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.pending).toBeUndefined();
      expect(result.creditedTo).toEqual({ kind: "corporation", name: "Borrower Corp" });
      // Corporation rate: prime 5 + offset 1, no character spread.
      expect(result.loan).toMatchObject({
        principal: 100_000,
        outstanding: 100_000,
        ratePercent: 6,
        termTurns: 48,
        status: "current",
        originatedTurn: 42,
      });

      const after = bankDoc(memory, bank._id);
      expect(after.bankCharter.cashReserves).toBe(before - 100_000);
      expect(after.bankCharter.totalLoans).toBe(100_000);
      expect(after.liquidCapital).toBe(50_000_000);
      expect(bankDoc(memory, BORROWER_CORP).liquidCapital).toBe(350_000);
      expect(memory.collection("bankLoans").docs).toHaveLength(1);

      const { emitTx } = await import("@/lib/financialTxLog/emit");
      const [, entry] = vi.mocked(emitTx).mock.calls.at(-1)!;
      expect(entry).toMatchObject({
        type: "bank_loan_origination",
        amount: 100_000,
        counterpartyType: "corporation",
        counterpartyId: bank._id,
      });
    });

    it("credits a character's personal balance at the spread rate", async () => {
      const { memory, bank } = world();
      const result = await originate(
        memory,
        bank,
        { type: "character", id: BORROWER_CHAR },
        10_000
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.loan.ratePercent).toBe(6 + CHARACTER_LOAN_SPREAD_PP);
      const person = memory.collection("characters").docs[0] as {
        currencyBalances: { personal: { USD: number } };
      };
      expect(person.currencyBalances.personal.USD).toBe(11_000);
    });

    it("lets an investment charter disburse a named corporation loan from its own cash", async () => {
      const { memory, bank } = world({
        type: "investment",
        npcDeposits: 0,
        totalLoans: 0,
        cashReserves: 500_000,
      });
      const result = await originate(
        memory,
        bank,
        { type: "corporation", id: BORROWER_CORP },
        200_000
      );
      expect(result.ok).toBe(true);
      expect(bankDoc(memory, bank._id).bankCharter.cashReserves).toBe(300_000);
      expect(bankDoc(memory, bank._id).bankCharter.totalLoans).toBe(200_000);
    });

    it("parks a loan as pending with no money movement when the bank requires approval", async () => {
      const { memory, bank } = world({ requireApproval: true });
      const before = bankDoc(memory, bank._id).bankCharter.cashReserves;
      const result = await originate(
        memory,
        bank,
        { type: "corporation", id: BORROWER_CORP },
        100_000
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.pending).toBe(true);
      expect(result.loan).toMatchObject({ status: "pending", requestedTurn: 42 });
      expect(bankDoc(memory, bank._id).bankCharter.cashReserves).toBe(before);
      expect(bankDoc(memory, bank._id).bankCharter.totalLoans ?? 0).toBe(0);
      expect(bankDoc(memory, BORROWER_CORP).liquidCapital).toBe(250_000);
      const { emitTx } = await import("@/lib/financialTxLog/emit");
      expect(vi.mocked(emitTx).mock.calls.some(([, e]) => e.type === "bank_loan_origination")).toBe(
        false
      );
    });

    it("emits no ledger leg when origination fails", async () => {
      const { memory, bank } = world({ cashReserves: 10 });
      const { emitTx } = await import("@/lib/financialTxLog/emit");
      vi.mocked(emitTx).mockClear();
      const result = await originate(
        memory,
        bank,
        { type: "corporation", id: BORROWER_CORP },
        1_000
      );
      expect(result.ok).toBe(false);
      expect(emitTx).not.toHaveBeenCalled();
      expect(memory.collection("bankLoans").docs).toHaveLength(0);
    });

    it("conserves money across origination", async () => {
      const { memory, bank } = world();
      const total = () =>
        (
          memory.collection("corporations").docs as {
            liquidCapital: number;
            bankCharter?: { cashReserves?: number };
          }[]
        ).reduce((sum, c) => sum + c.liquidCapital + (c.bankCharter?.cashReserves ?? 0), 0);
      const before = total();
      await originate(memory, bank, { type: "corporation", id: BORROWER_CORP }, 100_000);
      expect(total()).toBe(before);
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
