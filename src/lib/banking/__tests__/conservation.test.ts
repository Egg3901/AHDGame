/**
 * Money is conserved across a bank's whole life.
 *
 * Private banking did not die of one bug. It died of fifteen fixes for the same
 * bug, because each fix was verified by asserting that the write it made was
 * the write it intended. Every one of those assertions passed while the world's
 * money supply drifted, since a leak lives in the arithmetic BETWEEN two
 * correct writes: a deposit book credited back to the central bank while the
 * matching cash stayed in the vault, a shareholder refund paid out of money
 * that had already been returned to depositors, interest credited with nothing
 * debited.
 *
 * This test asserts the only property that catches that class: after every
 * step, the total money in the world is what it was before the step, plus
 * whatever was explicitly minted, minus whatever was explicitly burned. It runs
 * a bank through charter, deposits, lending, interest, an upstream to the
 * owner, and then failure and resolution, and checks the total after each.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { injectBankCapital, upstreamBankCash } from "@/lib/banking/bankCash";
import { bankBalanceSheet } from "@/lib/banking/balanceSheet";
import { applyMoneyMove } from "@/lib/banking/moneyMove";
import { returnDepositBook } from "@/lib/banking/depositBookReturn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const CORP_ID = new ObjectId();
const CB_ID = "US";
const RESERVE_RATIO = 0.1;

/**
 * Everything that can hold money in this fixture.
 *
 * The list is the test: a quantity that is not in it is a quantity nobody is
 * watching, which is exactly how the original holes survived.
 */
function totalMoney(db: InMemoryDb): number {
  const corps = db.collection("corporations").docs as {
    liquidCapital?: number;
    bankCharter?: { cashReserves?: number };
  }[];
  const chars = db.collection("characters").docs as {
    currencyBalances?: { savings?: Record<string, number> };
  }[];
  const banks = db.collection("centralBanks").docs as { externalBroadMoney?: number }[];
  const funds = db.collection("depositInsuranceFunds").docs as { balance?: number }[];

  const corpMoney = corps.reduce(
    (sum, c) => sum + (c.liquidCapital ?? 0) + (c.bankCharter?.cashReserves ?? 0),
    0
  );
  const charMoney = chars.reduce((sum, c) => sum + (c.currencyBalances?.savings?.USD ?? 0), 0);
  const cbMoney = banks.reduce((sum, b) => sum + (b.externalBroadMoney ?? 0), 0);
  const fundMoney = funds.reduce((sum, f) => sum + (f.balance ?? 0), 0);
  return corpMoney + charMoney + cbMoney + fundMoney;
}

function makeWorld(overrides: { cashReserves?: number; npcDeposits?: number; fund?: number } = {}) {
  const db = createInMemoryDb();
  db.seed("corporations", [
    {
      _id: CORP_ID,
      name: "Test Bank",
      countryId: "US",
      liquidCapital: 40_000_000,
      bankCharter: {
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        postedCapital: 10_000_000,
        cashReserves: overrides.cashReserves ?? 10_000_000,
        npcDeposits: overrides.npcDeposits ?? 0,
        totalDeposits: overrides.npcDeposits ?? 0,
        totalLoans: 0,
        depositOffset: 0,
        lendingOffset: 0,
        capitalStanding: "adequate",
      },
    },
  ]);
  db.seed("centralBanks", [{ _id: CB_ID, externalBroadMoney: 500_000_000 }]);
  db.seed("depositInsuranceFunds", [{ _id: "USD", balance: overrides.fund ?? 0 }]);
  db.seed("characters", [
    {
      _id: new ObjectId(),
      name: "Depositor",
      currencyBalances: {
        savings: { USD: 2_000_000 },
        savingsHolder: { USD: CORP_ID.toString() },
      },
    },
  ]);
  return db;
}

function charterOf(db: InMemoryDb) {
  const corp = db.collection("corporations").docs[0] as {
    liquidCapital: number;
    bankCharter: Record<string, number | string>;
  };
  return corp;
}

describe("private banking conserves money", () => {
  let db: InMemoryDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeWorld();
  });

  it("posting capital moves money across the ring-fence and creates none", async () => {
    const before = totalMoney(db);
    const result = await injectBankCapital(db as unknown as Db, CORP_ID, 5_000_000);
    expect(result.ok).toBe(true);
    expect(totalMoney(db)).toBe(before);

    const corp = charterOf(db);
    expect(corp.liquidCapital).toBe(35_000_000);
    expect(corp.bankCharter.cashReserves).toBe(15_000_000);
    // Posted capital is a memo of where the cash came from, not a second pot.
    expect(corp.bankCharter.postedCapital).toBe(15_000_000);
  });

  it("taking a household deposit moves cash out of the money supply, not into existence", async () => {
    const before = totalMoney(db);
    const deposit = 20_000_000;

    const move = await applyMoneyMove(db as unknown as Db, {
      key: "test-deposit-inflow",
      kind: "npc_deposit_flow",
      legs: [
        {
          kind: "debit",
          amount: deposit,
          collection: "centralBanks",
          filter: { _id: CB_ID },
          path: "externalBroadMoney",
          note: "household money leaves the money supply",
        },
        {
          kind: "credit",
          amount: deposit,
          collection: "corporations",
          filter: { _id: CORP_ID },
          path: "bankCharter.cashReserves",
          note: "and arrives in the bank's vault",
        },
      ],
    });

    expect(move.status).toBe("applied");
    expect(totalMoney(db)).toBe(before);
  });

  it("refuses a move whose legs do not net to zero, and moves nothing", async () => {
    const before = totalMoney(db);
    const move = await applyMoneyMove(db as unknown as Db, {
      key: "test-unbalanced",
      kind: "broken",
      legs: [
        {
          kind: "credit",
          amount: 1_000_000,
          collection: "corporations",
          filter: { _id: CORP_ID },
          path: "bankCharter.cashReserves",
          note: "money from nowhere",
        },
      ],
    });

    expect(move.status).toBe("rejected");
    expect(totalMoney(db)).toBe(before);
  });

  it("replays a claimed key without moving money a second time", async () => {
    const legs = [
      {
        kind: "debit" as const,
        amount: 1_000_000,
        collection: "corporations",
        filter: { _id: CORP_ID },
        path: "bankCharter.cashReserves",
        note: "out",
      },
      {
        kind: "credit" as const,
        amount: 1_000_000,
        collection: "corporations",
        filter: { _id: CORP_ID },
        path: "liquidCapital",
        note: "in",
      },
    ];
    const first = await applyMoneyMove(db as unknown as Db, { key: "k", kind: "test", legs });
    const cashAfterFirst = charterOf(db).bankCharter.cashReserves;
    const second = await applyMoneyMove(db as unknown as Db, { key: "k", kind: "test", legs });

    expect(first.status).toBe("applied");
    expect(second.status).toBe("replayed");
    expect(charterOf(db).bankCharter.cashReserves).toBe(cashAfterFirst);
  });

  it("never lets a guarded debit overdraw a balance", async () => {
    const before = totalMoney(db);
    const move = await applyMoneyMove(db as unknown as Db, {
      key: "overdraw",
      kind: "test",
      legs: [
        {
          kind: "debit",
          amount: 999_000_000,
          collection: "corporations",
          filter: { _id: CORP_ID },
          path: "bankCharter.cashReserves",
          note: "more than the bank holds",
        },
        {
          kind: "credit",
          amount: 999_000_000,
          collection: "corporations",
          filter: { _id: CORP_ID },
          path: "liquidCapital",
          note: "to the parent",
        },
      ],
    });

    expect(move.status).toBe("partial");
    expect(charterOf(db).bankCharter.cashReserves).toBe(10_000_000);
    expect(totalMoney(db)).toBe(before);
  });

  it("upstreams only book equity, and borrowed money is never capital (regression, #83)", async () => {
    // A bank funded entirely by a discount-window draw: cash looks healthy and
    // every unit of it is owed to the central bank.
    db = makeWorld({ cashReserves: 10_000_000 });
    const corp = db.collection("corporations").docs[0] as Record<string, unknown>;
    (corp.bankCharter as Record<string, unknown>).discountWindowDebt = 10_000_000;

    const sheet = bankBalanceSheet({
      charter: (corp as { bankCharter: never }).bankCharter,
      reserveRatio: RESERVE_RATIO,
    });
    expect(sheet.bookEquity).toBe(0);
    expect(sheet.distributable).toBe(0);

    const before = totalMoney(db);
    const result = await upstreamBankCash(db as unknown as Db, CORP_ID, 5_000_000, RESERVE_RATIO);
    expect(result.ok).toBe(false);
    expect(totalMoney(db)).toBe(before);
  });

  it("upstream pays the owner out of equity and conserves the total", async () => {
    const before = totalMoney(db);
    const result = await upstreamBankCash(db as unknown as Db, CORP_ID, 4_000_000, RESERVE_RATIO);

    expect(result.ok).toBe(true);
    expect(totalMoney(db)).toBe(before);
    expect(charterOf(db).liquidCapital).toBe(44_000_000);
    expect(charterOf(db).bankCharter.cashReserves).toBe(6_000_000);
  });

  it("returns a fully cash-backed deposit book without creating or destroying money", async () => {
    db = makeWorld({ cashReserves: 30_000_000, npcDeposits: 20_000_000 });
    const before = totalMoney(db);

    const result = await returnDepositBook(db as unknown as Db, CORP_ID, {
      cause: "charter_switch",
      turn: 10,
      releaseResidualToOwner: false,
    });

    expect(result.returned).toBe(true);
    expect(result.npcReturned).toBe(20_000_000);
    expect(result.fromBankCash).toBe(20_000_000);
    expect(result.fromInsuranceFund).toBe(0);
    expect(totalMoney(db)).toBe(before);

    // The household book left the bank AND arrived in the money supply exactly
    // once. The old switch path credited the money supply and kept the cash.
    expect(charterOf(db).bankCharter.cashReserves).toBe(10_000_000);
    expect(
      (db.collection("centralBanks").docs[0] as { externalBroadMoney: number }).externalBroadMoney
    ).toBe(520_000_000);
    expect(charterOf(db).bankCharter.npcDeposits).toBe(0);

    // The player's pointer went home and their balance never moved: it was
    // never at the bank in the first place.
    const depositor = db.collection("characters").docs[0] as {
      currencyBalances: { savings: { USD: number }; savingsHolder: { USD: string } };
    };
    expect(depositor.currencyBalances.savingsHolder.USD).toBe("centralBank");
    expect(depositor.currencyBalances.savings.USD).toBe(2_000_000);
  });

  it("covers a shortfall from the insurance fund before the treasury, and books both", async () => {
    // A failed bank: it owes 20M of household deposits and holds 5M.
    db = makeWorld({ cashReserves: 5_000_000, npcDeposits: 20_000_000, fund: 6_000_000 });
    db.seed("federalBudget", [
      { _id: "federal", treasuryBalance: 100_000_000, spending: { total: 0, byCategory: {} } },
    ]);
    const before = totalMoney(db);

    const result = await returnDepositBook(db as unknown as Db, CORP_ID, {
      cause: "failure",
      turn: 11,
      releaseResidualToOwner: false,
    });

    expect(result.fromBankCash).toBe(5_000_000);
    expect(result.fromInsuranceFund).toBe(6_000_000);
    expect(result.fromTreasury).toBe(9_000_000);

    // The treasury backstop is money entering the world, and it is the ONLY
    // money entering the world here, so the total moves by exactly that much.
    expect(totalMoney(db)).toBe(before + 9_000_000);
    const budget = db.collection("federalBudget").docs[0] as {
      treasuryBalance: number;
      spending: { total: number };
    };
    expect(budget.treasuryBalance).toBe(91_000_000);
    expect(budget.spending.total).toBe(9_000_000);
  });

  it("pays depositors before owners on a revocation", async () => {
    // Cash covers the deposit book with 4M to spare, and equity is 4M.
    db = makeWorld({ cashReserves: 24_000_000, npcDeposits: 20_000_000 });
    const before = totalMoney(db);

    const result = await returnDepositBook(db as unknown as Db, CORP_ID, {
      cause: "revocation",
      turn: 12,
      releaseResidualToOwner: true,
    });

    expect(result.npcReturned).toBe(20_000_000);
    expect(result.ownerResidual).toBe(4_000_000);
    expect(totalMoney(db)).toBe(before);
    expect(charterOf(db).bankCharter.cashReserves).toBe(0);
    expect(charterOf(db).liquidCapital).toBe(44_000_000);
  });

  it("does not pay the owner ahead of a lender on a revocation", async () => {
    db = makeWorld({ cashReserves: 24_000_000, npcDeposits: 20_000_000 });
    const corp = db.collection("corporations").docs[0] as Record<string, unknown>;
    // Every unit of the surplus is owed on the interbank market.
    (corp.bankCharter as Record<string, unknown>).interbankDebt = 4_000_000;
    const before = totalMoney(db);

    const result = await returnDepositBook(db as unknown as Db, CORP_ID, {
      cause: "revocation",
      turn: 13,
      releaseResidualToOwner: true,
    });

    expect(result.ownerResidual).toBe(0);
    expect(totalMoney(db)).toBe(before);
    // The cash stays on the charter for the lender rather than being handed to
    // a shareholder who ranks behind them.
    expect(charterOf(db).bankCharter.cashReserves).toBe(4_000_000);
  });

  it("is idempotent: a second resolution for the same cause and turn moves nothing", async () => {
    db = makeWorld({ cashReserves: 24_000_000, npcDeposits: 20_000_000 });
    await returnDepositBook(db as unknown as Db, CORP_ID, {
      cause: "revocation",
      turn: 14,
      releaseResidualToOwner: true,
    });
    const afterFirst = totalMoney(db);
    const cashAfterFirst = charterOf(db).bankCharter.cashReserves;

    const second = await returnDepositBook(db as unknown as Db, CORP_ID, {
      cause: "revocation",
      turn: 14,
      releaseResidualToOwner: true,
    });

    expect(second.returned).toBe(false);
    expect(totalMoney(db)).toBe(afterFirst);
    expect(charterOf(db).bankCharter.cashReserves).toBe(cashAfterFirst);
  });

  it("runs the whole life of a bank and conserves at every step", async () => {
    db = makeWorld();
    const opening = totalMoney(db);
    let minted = 0;

    // (1) Owner posts capital.
    await injectBankCapital(db as unknown as Db, CORP_ID, 5_000_000);
    expect(totalMoney(db)).toBe(opening);

    // (2) Households deposit: cash leaves the money supply for the vault.
    await applyMoneyMove(db as unknown as Db, {
      key: "life-deposit",
      kind: "npc_deposit_flow",
      legs: [
        {
          kind: "debit",
          amount: 60_000_000,
          collection: "centralBanks",
          filter: { _id: CB_ID },
          path: "externalBroadMoney",
          note: "deposits leave the money supply",
        },
        {
          kind: "credit",
          amount: 60_000_000,
          collection: "corporations",
          filter: { _id: CORP_ID },
          path: "bankCharter.cashReserves",
          note: "deposits arrive as vault cash",
        },
      ],
    });
    await db
      .collection("corporations")
      .updateOne(
        { _id: CORP_ID },
        { $set: { "bankCharter.npcDeposits": 60_000_000, "bankCharter.totalDeposits": 62_000_000 } }
      );
    expect(totalMoney(db)).toBe(opening);

    // (3) The bank lends: cash leaves the vault for the borrower.
    const borrowerId = new ObjectId();
    db.seed("corporations", [{ _id: borrowerId, name: "Borrower", liquidCapital: 0 }]);
    await applyMoneyMove(db as unknown as Db, {
      key: "life-loan",
      kind: "loan_origination",
      legs: [
        {
          kind: "debit",
          amount: 30_000_000,
          collection: "corporations",
          filter: { _id: CORP_ID },
          path: "bankCharter.cashReserves",
          note: "principal leaves the bank",
        },
        {
          kind: "credit",
          amount: 30_000_000,
          collection: "corporations",
          filter: { _id: borrowerId },
          path: "liquidCapital",
          note: "principal reaches the borrower",
        },
      ],
    });
    await db
      .collection("corporations")
      .updateOne({ _id: CORP_ID }, { $set: { "bankCharter.totalLoans": 30_000_000 } });
    expect(totalMoney(db)).toBe(opening);

    // (4) The borrower pays interest out of its own cash.
    db.seed("corporations", [{ _id: new ObjectId(), name: "Filler", liquidCapital: 0 }]);
    await db
      .collection("corporations")
      .updateOne({ _id: borrowerId }, { $inc: { liquidCapital: 1_000_000 } });
    minted += 1_000_000; // stands in for the borrower's revenue from outside the fixture
    await applyMoneyMove(db as unknown as Db, {
      key: "life-interest",
      kind: "loan_interest",
      legs: [
        {
          kind: "debit",
          amount: 500_000,
          collection: "corporations",
          filter: { _id: borrowerId },
          path: "liquidCapital",
          note: "borrower pays interest",
        },
        {
          kind: "credit",
          amount: 500_000,
          collection: "corporations",
          filter: { _id: CORP_ID },
          path: "bankCharter.cashReserves",
          note: "bank receives interest",
        },
      ],
    });
    expect(totalMoney(db)).toBe(opening + minted);

    // (5) The owner upstreams what is genuinely theirs.
    const sheetBefore = bankBalanceSheet({
      charter: (db.collection("corporations").docs[0] as { bankCharter: never }).bankCharter,
      reserveRatio: RESERVE_RATIO,
    });
    const upstream = await upstreamBankCash(
      db as unknown as Db,
      CORP_ID,
      sheetBefore.distributable,
      RESERVE_RATIO
    );
    expect(upstream.ok).toBe(true);
    expect(totalMoney(db)).toBe(opening + minted);

    // (6) The bank fails and is resolved.
    db.seed("federalBudget", [
      { _id: "federal", treasuryBalance: 100_000_000, spending: { total: 0, byCategory: {} } },
    ]);
    const beforeResolution = totalMoney(db);
    const resolution = await returnDepositBook(db as unknown as Db, CORP_ID, {
      cause: "failure",
      turn: 30,
      releaseResidualToOwner: false,
    });

    // Every household deposit is back in the money supply, funded first by the
    // bank and then by the insurance backstop, and the ONLY new money in the
    // world is the backstop the treasury deficit-financed.
    expect(resolution.npcReturned).toBe(60_000_000);
    expect(totalMoney(db)).toBe(beforeResolution + resolution.fromTreasury);

    // Nothing is left on the books that no cash stands behind.
    const finalCharter = charterOf(db).bankCharter;
    expect(finalCharter.npcDeposits).toBe(0);
    expect(finalCharter.totalDeposits).toBe(0);
  });

  it("pays secured central bank facilities before depositors, and burns what it repays", async () => {
    // 30M of cash against a 20M household book and a 12M discount window draw.
    // The window is senior, so it is made whole first and the depositors take
    // what is left, with insurance covering the rest.
    db = makeWorld({ cashReserves: 30_000_000, npcDeposits: 20_000_000, fund: 5_000_000 });
    const corp = db.collection("corporations").docs[0] as Record<string, unknown>;
    (corp.bankCharter as Record<string, unknown>).discountWindowDebt = 12_000_000;
    db.seed("federalBudget", [
      { _id: "federal", treasuryBalance: 100_000_000, spending: { total: 0, byCategory: {} } },
    ]);
    const before = totalMoney(db);

    const result = await returnDepositBook(db as unknown as Db, CORP_ID, {
      cause: "failure",
      turn: 40,
      releaseResidualToOwner: false,
    });

    expect(result.centralBankRepaid).toBe(12_000_000);
    expect(result.centralBankWrittenOff).toBe(0);
    // 18M of cash left for a 20M book, so insurance covers 2M: 5M fund, so all
    // of it comes from the fund and none from the treasury.
    expect(result.fromBankCash).toBe(18_000_000);
    expect(result.fromInsuranceFund).toBe(2_000_000);
    expect(result.fromTreasury).toBe(0);

    // The window's principal was minted on the draw, so repaying it destroys
    // that money: the world is exactly 12M smaller and nothing else moved.
    expect(totalMoney(db)).toBe(before - 12_000_000);
    expect(charterOf(db).bankCharter.discountWindowDebt).toBe(0);
    expect(charterOf(db).bankCharter.cashReserves).toBe(0);
  });

  it("extinguishes a central bank claim the estate cannot pay, and creates nothing", async () => {
    db = makeWorld({ cashReserves: 0, npcDeposits: 0 });
    const corp = db.collection("corporations").docs[0] as Record<string, unknown>;
    (corp.bankCharter as Record<string, unknown>).cbMarginDebt = 8_000_000;
    const before = totalMoney(db);

    const result = await returnDepositBook(db as unknown as Db, CORP_ID, {
      cause: "failure",
      turn: 41,
      releaseResidualToOwner: false,
    });

    expect(result.centralBankRepaid).toBe(0);
    expect(result.centralBankWrittenOff).toBe(8_000_000);
    // The central bank ate the loss. Money already in the world stays in it.
    expect(totalMoney(db)).toBe(before);
    expect(charterOf(db).bankCharter.cbMarginDebt).toBe(0);
  });

  it("pays interbank lenders pro rata after depositors and before the owner", async () => {
    db = makeWorld({ cashReserves: 26_000_000, npcDeposits: 20_000_000 });
    const corp = db.collection("corporations").docs[0] as Record<string, unknown>;
    (corp.bankCharter as Record<string, unknown>).interbankDebt = 8_000_000;
    const lenderA = new ObjectId();
    const lenderB = new ObjectId();
    db.seed("corporations", [
      { _id: lenderA, name: "Lender A", bankCharter: { cashReserves: 0, status: "active" } },
      { _id: lenderB, name: "Lender B", bankCharter: { cashReserves: 0, status: "active" } },
    ]);
    db.seed("interbankLoans", [
      {
        _id: new ObjectId(),
        lenderCorporationId: lenderA,
        borrowerCorporationId: CORP_ID,
        currency: "USD",
        principal: 6_000_000,
        outstanding: 6_000_000,
        ratePercent: 5,
        originatedTurn: 1,
        status: "current",
      },
      {
        _id: new ObjectId(),
        lenderCorporationId: lenderB,
        borrowerCorporationId: CORP_ID,
        currency: "USD",
        principal: 2_000_000,
        outstanding: 2_000_000,
        ratePercent: 5,
        originatedTurn: 1,
        status: "current",
      },
    ]);
    const before = totalMoney(db);

    const result = await returnDepositBook(db as unknown as Db, CORP_ID, {
      cause: "revocation",
      turn: 42,
      releaseResidualToOwner: true,
    });

    // 26M cash: 20M to depositors, 6M left against 8M of interbank claims, so
    // lenders recover three quarters each and the owner gets nothing.
    expect(result.npcReturned).toBe(20_000_000);
    expect(result.interbankRepaid).toBe(6_000_000);
    expect(result.interbankWrittenOff).toBe(2_000_000);
    expect(result.ownerResidual).toBe(0);
    expect(totalMoney(db)).toBe(before);

    const lenders = db.collection("corporations").docs as {
      _id: ObjectId;
      bankCharter?: { cashReserves?: number };
    }[];
    const a = lenders.find((c) => c._id.equals(lenderA))!;
    const b = lenders.find((c) => c._id.equals(lenderB))!;
    expect(a.bankCharter!.cashReserves).toBeCloseTo(4_500_000, 6);
    expect(b.bankCharter!.cashReserves).toBeCloseTo(1_500_000, 6);

    const loans = db.collection("interbankLoans").docs as { status: string; outstanding: number }[];
    expect(loans.every((l) => l.status === "defaulted")).toBe(true);
    expect(loans.reduce((sum, l) => sum + l.outstanding, 0)).toBeCloseTo(2_000_000, 6);
  });
});
