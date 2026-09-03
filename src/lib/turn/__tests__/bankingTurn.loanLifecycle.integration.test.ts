/**
 * A named loan's whole life through the real turn, on the in-memory store.
 *
 * Two lifecycles: application to payoff, and application to write-off. Both
 * check the properties the journal exists for: money is conserved at every
 * turn, the loan advances exactly once per turn however many times the turn
 * runs, and the bank's cached loan total tracks the record.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { BankCharter, BankLoan } from "@/lib/db/types/bank";
import { ARREARS_DEFAULT_TURNS } from "@/lib/banking/rules/loans";
import { originateLoan } from "@/lib/banking/lending";
import { processBankingTurn } from "../bankingTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));

const START = 100;
const PRINCIPAL = 9_600;
const TERM = 8;

function makeWorld(borrowerCash: number): {
  db: InMemoryDb;
  bankId: ObjectId;
  borrowerId: ObjectId;
} {
  const db = createInMemoryDb();
  const bankId = new ObjectId();
  const borrowerId = new ObjectId();
  db.seed("gameConfig", [{ _id: "default", privateBankingEnabled: true }]);
  db.seed("gameState", [{ _id: "current", currentTurn: START, preset: "2019-default" }]);
  db.seed("centralBanks", [
    {
      _id: "US",
      countryId: "US",
      primeRate: 4,
      inflationHistory: [{ turn: 1, rate: 0 }],
      externalBroadMoney: 0,
      bankReserveRequirement: 0.1,
    },
  ]);
  db.seed("corporations", [
    {
      _id: bankId,
      name: "Lifecycle Bank",
      type: "financial",
      countryId: "US",
      liquidCapital: 0,
      liquidCurrencyCode: "USD",
      userId: new ObjectId(),
      bankCharter: {
        type: "investment",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        postedCapital: 1_000_000,
        cashReserves: 1_000_000,
        npcDeposits: 0,
        totalDeposits: 0,
        totalLoans: 0,
        depositOffset: 0,
        lendingOffset: 0,
        blacklist: {},
      } satisfies BankCharter,
    },
    {
      _id: borrowerId,
      name: "Borrower Inc",
      type: "manufacturing",
      countryId: "US",
      liquidCapital: borrowerCash,
      liquidCurrencyCode: "USD",
      userId: new ObjectId(),
    },
  ]);
  db.seed(
    "corporationHistory",
    Array.from({ length: 12 }, (_, i) => ({
      _id: new ObjectId(),
      corporationId: borrowerId,
      turn: START - 11 + i,
      income: 200_000,
    }))
  );
  return { db, bankId, borrowerId };
}

function corp(db: InMemoryDb, id: ObjectId) {
  return db.collection("corporations").docs.find((d) => (d._id as ObjectId).equals(id)) as {
    liquidCapital: number;
    bankCharter?: BankCharter;
  };
}

function money(db: InMemoryDb): number {
  return (
    db.collection("corporations").docs as { liquidCapital: number; bankCharter?: BankCharter }[]
  ).reduce((sum, c) => sum + c.liquidCapital + (c.bankCharter?.cashReserves ?? 0), 0);
}

function theLoan(db: InMemoryDb): BankLoan {
  return db.collection("bankLoans").docs[0] as unknown as BankLoan;
}

describe("named loan lifecycle through the banking turn", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs from application to payoff, conserving money and advancing once per turn", async () => {
    const { db, bankId, borrowerId } = makeWorld(1_000_000);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const before = money(db);

    const originated = await originateLoan(
      db as unknown as Db,
      bankId,
      { type: "corporation", id: borrowerId },
      PRINCIPAL,
      TERM
    );
    expect(originated.ok).toBe(true);
    expect(money(db)).toBe(before);
    expect(corp(db, bankId).bankCharter!.cashReserves).toBe(1_000_000 - PRINCIPAL);

    let paidInterest = 0;
    // Straight-line principal over the turns left in the term: the last
    // instalment falls on origination + term - 1, when one turn remains.
    for (let turn = START + 1; turn <= START + TERM - 1; turn += 1) {
      const first = await processBankingTurn(db as unknown as Db, turn);
      paidInterest += first.loanInterestCollected;
      const outstandingAfterFirst = theLoan(db).outstanding;
      // Running the same turn again is a replay: nothing advances, nothing is charged.
      const again = await processBankingTurn(db as unknown as Db, turn);
      expect(again.banksProcessed).toBe(0);
      expect(theLoan(db).outstanding).toBe(outstandingAfterFirst);
      expect(theLoan(db).lastProcessedTurn).toBe(turn);
      expect(money(db)).toBeCloseTo(before, 6);
      expect(corp(db, bankId).bankCharter!.totalLoans).toBeCloseTo(theLoan(db).outstanding, 6);
    }

    const loan = theLoan(db);
    expect(loan.status).toBe("repaid");
    expect(loan.outstanding).toBeCloseTo(0, 6);
    expect(corp(db, bankId).bankCharter!.totalLoans).toBeCloseTo(0, 6);
    // The bank ends with its principal back plus every instalment's interest.
    expect(corp(db, bankId).bankCharter!.cashReserves).toBeCloseTo(1_000_000 + paidInterest, 6);
    expect(paidInterest).toBeGreaterThan(0);
    expect(corp(db, borrowerId).liquidCapital).toBeCloseTo(1_000_000 - paidInterest, 6);
  });

  it("runs from application to write-off when the borrower cannot pay", async () => {
    const { db, bankId, borrowerId } = makeWorld(0);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const originated = await originateLoan(
      db as unknown as Db,
      bankId,
      { type: "corporation", id: borrowerId },
      PRINCIPAL,
      TERM
    );
    expect(originated.ok).toBe(true);
    // The borrower spends the proceeds at once.
    corp(db, borrowerId).liquidCapital = 0;
    const before = money(db);

    for (let i = 1; i < ARREARS_DEFAULT_TURNS; i += 1) {
      const summary = await processBankingTurn(db as unknown as Db, START + i);
      expect(summary.defaultsWrittenOff).toBe(0);
      expect(theLoan(db).status).toBe("arrears");
      expect(theLoan(db).arrearsTurns).toBe(i);
      expect(theLoan(db).outstanding).toBe(PRINCIPAL);
      expect(money(db)).toBe(before);
    }

    const defaulted = await processBankingTurn(db as unknown as Db, START + ARREARS_DEFAULT_TURNS);
    expect(defaulted.defaultsWrittenOff).toBeCloseTo(PRINCIPAL, 6);
    expect(theLoan(db).status).toBe("defaulted");
    expect(corp(db, bankId).bankCharter!.totalLoans).toBeCloseTo(0, 6);
    // A write-off destroys the asset, not cash: the world's money is unchanged
    // and the bank simply never gets its principal back.
    expect(money(db)).toBe(before);
    expect(corp(db, bankId).bankCharter!.cashReserves).toBe(1_000_000 - PRINCIPAL);

    // A defaulted loan is not serviced again.
    const after = await processBankingTurn(db as unknown as Db, START + ARREARS_DEFAULT_TURNS + 1);
    expect(after.defaultsWrittenOff).toBe(0);
    expect(theLoan(db).status).toBe("defaulted");
  });
});
