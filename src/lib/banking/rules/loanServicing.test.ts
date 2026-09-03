import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { ARREARS_DEFAULT_TURNS } from "./loans";
import { decideLoanService, loanServiceTransition } from "./loanServicing";
import { legsNet } from "./invariants";

const LOAN_ID = new ObjectId();
const BORROWER = new ObjectId();
const BANK = "a".repeat(24);

function loan(overrides: Partial<Parameters<typeof loanServiceTransition>[0]["loan"]> = {}) {
  return {
    _id: LOAN_ID,
    borrowerType: "corporation" as const,
    borrowerId: BORROWER,
    currency: "USD" as const,
    outstanding: 4_800,
    status: "current" as const,
    ratePercent: 4.8,
    originatedTurn: 100,
    termTurns: 48,
    arrearsTurns: 0,
    ...overrides,
  };
}

const vault = {
  collection: "corporations",
  filter: { _id: { $oid: BANK } },
  path: "bankCharter.cashReserves",
  note: "instalment reaches the lending bank",
};

describe("decideLoanService", () => {
  it("charges interest plus straight-line principal when the borrower can pay", () => {
    const d = decideLoanService({ loan: loan(), borrowerAvailable: 1_000_000, turn: 100 });
    const interest = (4_800 * 0.048) / TURNS_PER_YEAR;
    expect(d.outcome).toBe("paid");
    expect(d.interestPaid).toBeCloseTo(interest, 9);
    expect(d.principalPaid).toBeCloseTo(100, 9);
    expect(d.payment).toBeCloseTo(interest + 100, 9);
    expect(d.nextOutstanding).toBeCloseTo(4_700, 9);
    expect(d.status).toBe("current");
    expect(d.totalLoansDelta).toBeCloseTo(-100, 9);
  });

  it("closes the loan on the final instalment", () => {
    const d = decideLoanService({
      loan: loan({ outstanding: 100, originatedTurn: 100, termTurns: 48 }),
      borrowerAvailable: 1_000_000,
      turn: 147,
    });
    expect(d.status).toBe("repaid");
    expect(d.nextOutstanding).toBe(0);
  });

  it("pays interest first on a shortfall and counts an arrears turn", () => {
    const d = decideLoanService({ loan: loan(), borrowerAvailable: 3, turn: 100 });
    expect(d.outcome).toBe("delinquent");
    expect(d.interestPaid).toBe(3);
    expect(d.principalPaid).toBe(0);
    expect(d.status).toBe("arrears");
    expect(d.arrearsTurns).toBe(1);
    expect(d.nextOutstanding).toBe(4_800);
  });

  it("defaults after ARREARS_DEFAULT_TURNS shortfalls and writes off what is left", () => {
    const d = decideLoanService({
      loan: loan({ status: "arrears", arrearsTurns: ARREARS_DEFAULT_TURNS - 1 }),
      borrowerAvailable: 0,
      turn: 110,
    });
    expect(d.outcome).toBe("defaulted");
    expect(d.status).toBe("defaulted");
    expect(d.writtenOff).toBe(4_800);
    expect(d.totalLoansDelta).toBe(-4_800);
    expect(d.payment).toBe(0);
  });

  it("returns a loan back to current when arrears are caught up", () => {
    const d = decideLoanService({
      loan: loan({ status: "arrears", arrearsTurns: 3 }),
      borrowerAvailable: 1_000_000,
      turn: 100,
    });
    expect(d.status).toBe("current");
    expect(d.arrearsTurns).toBe(0);
  });

  it("closes a loan with nothing outstanding without charging", () => {
    const d = decideLoanService({
      loan: loan({ outstanding: 0 }),
      borrowerAvailable: 5,
      turn: 100,
    });
    expect(d).toMatchObject({ outcome: "closed", payment: 0, status: "repaid" });
  });
});

describe("loanServiceTransition", () => {
  it("builds a balanced two-leg move keyed per loan per turn, with a guarded loan update", () => {
    const { transition, decision } = loanServiceTransition({
      loan: loan(),
      borrowerAvailable: 1_000_000,
      turn: 100,
      creditTarget: vault,
      bankId: BANK,
    });
    expect(transition.key).toBe(`loan-service:${LOAN_ID.toHexString()}:100`);
    expect(Math.abs(legsNet(transition.legs))).toBeLessThan(1e-9);
    expect(transition.legs[0]).toMatchObject({
      kind: "debit",
      collection: "corporations",
      path: "liquidCapital",
      amount: decision.payment,
    });
    expect(transition.legs[1]).toMatchObject({ kind: "credit", path: "bankCharter.cashReserves" });
    expect(transition.projections[0].filter).toEqual({
      _id: { $oid: LOAN_ID.toHexString() },
      lastProcessedTurn: { $ne: 100 },
    });
    expect(transition.projections[0].update).toEqual({
      $set: {
        outstanding: decision.nextOutstanding,
        status: "current",
        arrearsTurns: 0,
        lastProcessedTurn: 100,
      },
    });
    expect(transition.event.kind).toBe("loan.paid");
  });

  it("carries no money legs when nothing is payable but still advances the loan", () => {
    const { transition } = loanServiceTransition({
      loan: loan({ status: "arrears", arrearsTurns: 2 }),
      borrowerAvailable: 0,
      turn: 100,
      creditTarget: vault,
      bankId: BANK,
    });
    expect(transition.legs).toEqual([]);
    expect(transition.projections[0].update).toMatchObject({
      $set: { status: "arrears", arrearsTurns: 3, lastProcessedTurn: 100 },
    });
    expect(transition.event.kind).toBe("loan.delinquent");
  });

  it("debits a character's personal balance and lands in the given target", () => {
    const insurer = {
      collection: "depositInsuranceFunds",
      filter: { _id: "USD" },
      path: "balance",
      note: "insurer",
    };
    const { transition } = loanServiceTransition({
      loan: loan({ borrowerType: "character" }),
      borrowerAvailable: 1_000_000,
      turn: 100,
      creditTarget: insurer,
      bankId: BANK,
    });
    expect(transition.legs[0]).toMatchObject({
      collection: "characters",
      path: "currencyBalances.personal.USD",
    });
    expect(transition.legs[1]).toMatchObject(insurer);
  });
});
