import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { BankCharter, InterbankLoan } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import { ARREARS_DEFAULT_TURNS, processBankingTurn } from "@/lib/turn/bankingTurn";
import {
  CB_MARGIN_COLLATERAL_FRACTION,
  CB_MARGIN_SPREAD_PP,
  INTERBANK_MAX_SHARE_OF_LENDABLE,
  drawCbMargin,
  lendInterbank,
  repayCbMargin,
  repayInterbank,
} from "../interbank";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
vi.mock("@/lib/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(50) }));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));

function makeCharter(type: BankCharter["type"], overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type,
    status: "active",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 100_000,
    depositOffset: 0,
    lendingOffset: 0,
    totalDeposits: 1_000_000,
    // Cash-backed household deposits: lendable headroom is measured against
    // these, never against player pointer balances.
    totalLoans: 0,
    npcDeposits: 1_000_000,
    propBookMarkValue: 0,
    interbankDebt: 0,
    cbMarginDebt: 0,
    ...overrides,
  };
}

describe("interbank lend/repay", () => {
  let memory: InMemoryDb;
  let lenderId: ObjectId;
  let borrowerId: ObjectId;

  function bank(id: ObjectId) {
    return memory.collection("corporations").docs.find((d) => (d._id as ObjectId).equals(id)) as {
      liquidCapital: number;
      bankCharter: BankCharter;
    };
  }
  function loans(): InterbankLoan[] {
    return memory.collection("interbankLoans").docs as unknown as InterbankLoan[];
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    memory = createInMemoryDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
    lenderId = new ObjectId();
    borrowerId = new ObjectId();
    memory.seed("gameConfig", [
      { _id: "default", privateBankingEnabled: true, bankPropTradingEnabled: true },
    ]);
    memory.seed("gameState", [{ _id: "current", currentTurn: 50, preset: "2019-default" }]);
    memory.seed("centralBanks", [
      { _id: "US", countryId: "US", bankReserveRequirement: 0.1, primeRate: 4 },
    ]);
    memory.seed("corporations", [
      {
        _id: lenderId,
        name: "Retail",
        countryId: "US",
        liquidCapital: 0,
        liquidCurrencyCode: "USD",
        bankCharter: makeCharter("retail", {
          totalDeposits: 1_000_000,
          npcDeposits: 1_000_000,
          // Cash-backed household deposits: lendable headroom is measured against
          // these, never against player pointer balances.
          totalLoans: 0,
          cashReserves: 500_000,
        }),
      },
      {
        _id: borrowerId,
        name: "IB",
        countryId: "US",
        liquidCapital: 0,
        liquidCurrencyCode: "USD",
        bankCharter: makeCharter("investment", {
          totalDeposits: 0,
          totalLoans: 0,
          propBookMarkValue: 200_000,
          cashReserves: 50_000,
        }),
      },
    ]);
  });

  it("caps lend amount at INTERBANK_MAX_SHARE_OF_LENDABLE × headroom", async () => {
    // headroom = 1_000_000 * 0.9 = 900_000; max share = 450_000
    const result = await lendInterbank(memory as unknown as Db, lenderId, borrowerId, 450_001, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/headroom/i);
    expect(loans()).toHaveLength(0);
  });

  it("moves cash lender → borrower and tracks interbankDebt (not totalLoans)", async () => {
    const lenderBefore = bank(lenderId).bankCharter.cashReserves!;
    const borrowerBefore = bank(borrowerId).bankCharter.cashReserves!;
    const result = await lendInterbank(memory as unknown as Db, lenderId, borrowerId, 100_000, 5);
    expect(result.ok).toBe(true);
    expect(bank(lenderId).bankCharter.cashReserves).toBe(lenderBefore - 100_000);
    expect(bank(borrowerId).bankCharter.cashReserves).toBe(borrowerBefore + 100_000);
    expect(bank(borrowerId).bankCharter.interbankDebt).toBe(100_000);
    expect(bank(lenderId).bankCharter.totalLoans).toBe(0);
    expect(loans()).toHaveLength(1);
    expect(loans()[0]).toMatchObject({
      principal: 100_000,
      outstanding: 100_000,
      status: "current",
    });
  });

  it("repay moves cash back and reduces debt, and repays no more than outstanding", async () => {
    const lent = await lendInterbank(memory as unknown as Db, lenderId, borrowerId, 100_000, 5);
    expect(lent.ok).toBe(true);
    if (!lent.ok) return;
    const repaid = await repayInterbank(memory as unknown as Db, lent.loan._id, 40_000);
    expect(repaid).toEqual({ ok: true, repaid: 40_000, outstanding: 60_000 });
    expect(bank(borrowerId).bankCharter.interbankDebt).toBe(60_000);
    expect(loans()[0]!.outstanding).toBe(60_000);
    expect(bank(lenderId).bankCharter.cashReserves).toBe(440_000);

    const rest = await repayInterbank(memory as unknown as Db, lent.loan._id, 1_000_000);
    expect(rest).toEqual({ ok: true, repaid: 60_000, outstanding: 0 });
    expect(loans()[0]).toMatchObject({ status: "repaid", outstanding: 0 });
    expect(bank(borrowerId).bankCharter.interbankDebt).toBe(0);
  });

  it("refuses a lender that cannot lend, a borrower that cannot borrow, and a currency mismatch", async () => {
    bank(lenderId).bankCharter.type = "investment";
    expect(await lendInterbank(memory as unknown as Db, lenderId, borrowerId, 1_000, 5)).toEqual({
      ok: false,
      error: "Only active retail or universal charters may lend on the interbank market",
    });
    bank(lenderId).bankCharter.type = "retail";
    bank(borrowerId).bankCharter.type = "retail";
    expect(await lendInterbank(memory as unknown as Db, lenderId, borrowerId, 1_000, 5)).toEqual({
      ok: false,
      error: "Borrower must have an active investment or universal charter",
    });
    bank(borrowerId).bankCharter.type = "investment";
    bank(borrowerId).bankCharter.currency = "GBP";
    expect(await lendInterbank(memory as unknown as Db, lenderId, borrowerId, 1_000, 5)).toEqual({
      ok: false,
      error: "Lender and borrower charter currencies must match",
    });
  });

  it("ledgers both legs: lend and repay each emit a two-sided corp tx", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.mocked(emitTx).mockClear();
    const lent = await lendInterbank(memory as unknown as Db, lenderId, borrowerId, 100_000, 5);
    expect(lent.ok).toBe(true);
    if (!lent.ok) return;
    expect(emitTx).toHaveBeenCalledTimes(1);
    const [, lendEntry] = vi.mocked(emitTx).mock.calls[0]!;
    expect(lendEntry).toMatchObject({
      type: "bank_interbank_lend",
      amount: 100_000,
      counterpartyType: "corporation",
    });
    await repayInterbank(memory as unknown as Db, lent.loan._id, 40_000);
    expect(emitTx).toHaveBeenCalledTimes(2);
    const [, repayEntry] = vi.mocked(emitTx).mock.calls[1]!;
    expect(repayEntry).toMatchObject({
      type: "bank_interbank_repay",
      amount: -40_000,
      counterpartyType: "corporation",
    });
  });
});

describe("CB margin draw/repay", () => {
  let memory: InMemoryDb;
  let corpId: ObjectId;

  function live() {
    return memory.collection("corporations").docs[0] as unknown as Corporation;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    memory = createInMemoryDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);

    corpId = new ObjectId();
    memory.seed("gameConfig", [
      { _id: "default", privateBankingEnabled: true, bankPropTradingEnabled: true },
    ]);
    memory.seed("gameState", [{ _id: "current", currentTurn: 50, preset: "2019-default" }]);
    memory.seed("centralBanks", [
      { _id: "US", countryId: "US", primeRate: 4, bankReserveRequirement: 0.1 },
    ]);
    memory.seed("corporations", [
      {
        _id: corpId,
        name: "IB",
        countryId: "US",
        liquidCapital: 0,
        liquidCurrencyCode: "USD",
        bankCharter: makeCharter("investment", {
          propBookMarkValue: 100_000,
          cbMarginDebt: 0,
          cashReserves: 10_000,
        }),
      },
    ]);
  });

  it("caps draw at CB_MARGIN_COLLATERAL_FRACTION × prop mark", async () => {
    // max debt = 0.5 * 100_000 = 50_000
    const over = await drawCbMargin(memory as unknown as Db, corpId, 50_001);
    expect(over.ok).toBe(false);
    const ok = await drawCbMargin(memory as unknown as Db, corpId, 50_000);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    // Creation: liquid rises, debt rises (no CB pool debit).
    expect(live().bankCharter!.cashReserves).toBe(60_000);
    expect(live().bankCharter!.cbMarginDebt).toBe(50_000);
    expect(ok).toMatchObject({ amount: 50_000, cbMarginDebt: 50_000, cashReserves: 60_000 });
  });

  it("destroys cash on repay (creation/destruction symmetry)", async () => {
    await drawCbMargin(memory as unknown as Db, corpId, 40_000);
    const before = live().bankCharter!.cashReserves!;
    const repaid = await repayCbMargin(memory as unknown as Db, corpId, 15_000);
    expect(repaid.ok).toBe(true);
    expect(live().bankCharter!.cashReserves).toBe(before - 15_000);
    expect(live().bankCharter!.cbMarginDebt).toBe(25_000);
  });

  it("ledgers draw/repay and mirrors netMoneyCreatedLifetime on the CB", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.mocked(emitTx).mockClear();
    await drawCbMargin(memory as unknown as Db, corpId, 40_000);
    expect(emitTx).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitTx).mock.calls[0]![1]).toMatchObject({
      type: "bank_cb_margin_draw",
      amount: 40_000,
    });
    expect(memory.collection("centralBanks").docs[0]).toMatchObject({
      netMoneyCreatedLifetime: 40_000,
    });
    await repayCbMargin(memory as unknown as Db, corpId, 15_000);
    expect(emitTx).toHaveBeenCalledTimes(2);
    expect(vi.mocked(emitTx).mock.calls[1]![1]).toMatchObject({
      type: "bank_cb_margin_repay",
      amount: -15_000,
    });
    expect(memory.collection("centralBanks").docs[0]).toMatchObject({
      netMoneyCreatedLifetime: 25_000,
    });
  });

  it("refuses a retail charter and a switched-off margin line with the old wording", async () => {
    live().bankCharter!.type = "retail";
    const retail = await drawCbMargin(memory as unknown as Db, corpId, 1);
    expect(retail).toEqual({
      ok: false,
      error: "Only active investment or universal charters may draw CB margin",
    });
    live().bankCharter!.type = "investment";
    memory.collection("gameConfig").docs[0].bankPropTradingEnabled = false;
    const off = await drawCbMargin(memory as unknown as Db, corpId, 1);
    expect(off).toEqual({ ok: false, error: "CB margin line is not enabled" });
  });

  it("exports provisional constants", () => {
    expect(CB_MARGIN_SPREAD_PP).toBe(1.5);
    expect(CB_MARGIN_COLLATERAL_FRACTION).toBe(0.5);
    expect(INTERBANK_MAX_SHARE_OF_LENDABLE).toBe(0.5);
  });
});

describe("interbank default write-off via bankingTurn", () => {
  let memory: InMemoryDb;
  let lenderId: ObjectId;
  let borrowerId: ObjectId;

  function bank(id: ObjectId) {
    return memory.collection("corporations").docs.find((d) => (d._id as ObjectId).equals(id)) as {
      bankCharter: BankCharter;
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    memory = createInMemoryDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
    lenderId = new ObjectId();
    borrowerId = new ObjectId();
    memory.seed("gameConfig", [
      { _id: "default", privateBankingEnabled: true, bankPropTradingEnabled: true },
    ]);
    memory.seed("gameState", [{ _id: "current", currentTurn: 100, preset: "2019-default" }]);
    memory.seed("centralBanks", [
      {
        _id: "US",
        countryId: "US",
        primeRate: 4,
        inflationHistory: [{ turn: 1, rate: 0 }],
        externalBroadMoney: 0,
        bankReserveRequirement: 0.1,
      },
    ]);
    // Both charters already stamped for this turn, so only the interbank pass runs.
    memory.seed("corporations", [
      {
        _id: lenderId,
        name: "Retail",
        countryId: "US",
        liquidCapital: 0,
        liquidCurrencyCode: "USD",
        bankCharter: makeCharter("retail", {
          totalDeposits: 0,
          npcDeposits: 0,
          totalLoans: 0,
          cashReserves: 500_000,
          lastBankingTurn: 100,
        }),
      },
      {
        _id: borrowerId,
        name: "IB",
        countryId: "US",
        liquidCapital: 0,
        liquidCurrencyCode: "USD",
        bankCharter: makeCharter("investment", {
          interbankDebt: 10_000,
          cashReserves: 0,
          lastBankingTurn: 100,
        }),
      },
    ]);
    memory.seed("interbankLoans", [
      {
        _id: new ObjectId(),
        lenderCorporationId: lenderId,
        borrowerCorporationId: borrowerId,
        currency: "USD",
        principal: 10_000,
        outstanding: 10_000,
        ratePercent: 12,
        originatedTurn: 1,
        status: "current",
        arrearsTurns: ARREARS_DEFAULT_TURNS - 1,
      },
    ]);
  });

  it("defaults after ARREARS_DEFAULT_TURNS and writes off to lender (no cash recovery)", async () => {
    const lenderCashBefore = bank(lenderId).bankCharter.cashReserves!;
    const summary = await processBankingTurn(memory as unknown as Db, 100);
    const loan = memory.collection("interbankLoans").docs[0] as unknown as InterbankLoan;
    expect(loan.status).toBe("defaulted");
    expect(loan.lastProcessedTurn).toBe(100);
    expect(summary.interbankDefaultsWrittenOff).toBe(10_000);
    // Borrower had 0 liquid so no interest paid; lender cash unchanged on writeoff.
    expect(bank(lenderId).bankCharter.cashReserves).toBe(lenderCashBefore);
    expect(bank(borrowerId).bankCharter.interbankDebt).toBe(0);

    // A re-run of the same turn is a replay: nothing is written off twice.
    const again = await processBankingTurn(memory as unknown as Db, 100);
    expect(again.interbankDefaultsWrittenOff).toBe(0);
    expect(bank(borrowerId).bankCharter.interbankDebt).toBe(0);
  });

  it("pays interest into the lender's vault when the borrower can, once per turn", async () => {
    bank(borrowerId).bankCharter.cashReserves = 1_000;
    const loanDoc = memory.collection("interbankLoans").docs[0] as { arrearsTurns: number };
    loanDoc.arrearsTurns = 0;
    const summary = await processBankingTurn(memory as unknown as Db, 100);
    // 10_000 x 12% / 48 = 25
    expect(summary.interbankInterestPaid).toBeCloseTo(25, 9);
    expect(bank(lenderId).bankCharter.cashReserves).toBeCloseTo(500_000 + 25, 9);
    expect(bank(borrowerId).bankCharter.cashReserves).toBeCloseTo(975, 9);
    const again = await processBankingTurn(memory as unknown as Db, 100);
    expect(again.interbankInterestPaid).toBe(0);
    expect(bank(borrowerId).bankCharter.cashReserves).toBeCloseTo(975, 9);
  });
});
