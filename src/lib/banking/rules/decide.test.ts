/**
 * Contract tests for the Banking Rules boundary.
 *
 * These assert only what comes back: the decision, its refusal, and the
 * transition's legs and projections. They never look at which helper was
 * called, because the whole point of the boundary is that the caller does
 * not need to know.
 */

import { describe, expect, it } from "vitest";
import { BANKING_POLICY_ALL_ON, resolveBankingPolicy } from "./policy";
import { legsNet } from "./invariants";
import { decideBankCommand } from "./decide";
import type { BankCharterSnapshot, BankCommand, BankingSnapshot } from "./boundary";

const BANK = "a".repeat(24);
const OTHER = "b".repeat(24);
const LOAN = "c".repeat(24);

function retail(overrides: Partial<BankCharterSnapshot> = {}): BankCharterSnapshot {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    postedCapital: 1_000_000,
    cashReserves: 1_000_000,
    npcDeposits: 4_000_000,
    totalDeposits: 4_000_000,
    totalLoans: 2_000_000,
    depositOffset: 0,
    lendingOffset: 2,
    ...overrides,
  };
}

function snapshot(overrides: Partial<BankingSnapshot> = {}): BankingSnapshot {
  return {
    turn: 200,
    policy: BANKING_POLICY_ALL_ON,
    bankId: BANK,
    currency: "USD",
    charter: retail(),
    corporationLiquidCapital: 500_000,
    reserveRatio: 0.1,
    primeRate: 4,
    centralBankId: "US",
    ...overrides,
  };
}

const OPTS = { commandId: "cmd-1" };

function decide(command: BankCommand, snap = snapshot()) {
  return decideBankCommand(snap, command, OPTS);
}

function balanced(decision: ReturnType<typeof decide>) {
  expect(decision.allowed).toBe(true);
  if (!decision.allowed) throw new Error("refused");
  expect(Math.abs(legsNet(decision.transition.legs))).toBeLessThan(1e-9);
  return decision;
}

describe("capital injection and upstream", () => {
  it("moves treasury cash into the vault and records posted capital", () => {
    const decision = balanced(decide({ type: "inject_capital", amount: 250_000 }));
    const { transition } = decision;
    expect(transition.key).toBe(`bank_capital_injection:${BANK}:200:cmd-1`);
    expect(transition.legs.map((l) => [l.kind, l.amount, l.path])).toEqual([
      ["debit", 250_000, "liquidCapital"],
      ["credit", 250_000, "bankCharter.cashReserves"],
    ]);
    expect(transition.projections[0].update).toEqual({
      $inc: { "bankCharter.postedCapital": 250_000 },
    });
    expect(transition.event.kind).toBe("charter.issued");
  });

  it("refuses an injection the corporation cannot fund", () => {
    const decision = decide({ type: "inject_capital", amount: 600_000 });
    expect(decision).toMatchObject({
      allowed: false,
      refusal: { code: "insufficient_funds", available: 500_000 },
    });
  });

  it("caps an upstream at the distributable line and re-gates the reserve floor", () => {
    // equity = 1M + 2M - 4M = -1M, so nothing is distributable.
    expect(decide({ type: "upstream_cash", amount: 1 })).toMatchObject({
      allowed: false,
      refusal: { code: "cap", cap: "distributable" },
    });
    const rich = snapshot({ charter: retail({ totalLoans: 3_500_000, cashReserves: 900_000 }) });
    // equity = 0.9M + 3.5M - 4M = 0.4M; surplus = 0.9M - 0.4M = 0.5M; distributable 0.4M
    const decision = balanced(decide({ type: "upstream_cash", amount: 10_000_000 }, rich));
    expect(decision.transition.legs[0].amount).toBe(400_000);
    expect(decision.transition.legs[0].filter).toMatchObject({
      "bankCharter.cashReserves": { $gte: 400_000 + 400_000 },
    });
    expect(decision.transition.projections[0].update).toEqual({
      $inc: { "bankCharter.postedCapital": -400_000 },
    });
  });

  it("refuses an upstream from a bank the supervisor has not called adequate", () => {
    const stressed = snapshot({ charter: retail({ capitalStanding: "stressed" }) });
    expect(decide({ type: "upstream_cash", amount: 1 }, stressed)).toMatchObject({
      allowed: false,
      refusal: { code: "state", detail: "stressed" },
    });
  });
});

describe("central bank facilities", () => {
  it("mints a discount-window draw against the deposit base", () => {
    const decision = balanced(decide({ type: "draw_discount_window", amount: 100_000 }));
    expect(decision.transition.legs.map((l) => l.kind)).toEqual(["mint", "credit"]);
    expect(decision.transition.projections.map((p) => p.update)).toEqual([
      { $inc: { "bankCharter.discountWindowDebt": 100_000 } },
      { $inc: { netMoneyCreatedLifetime: 100_000 } },
    ]);
    expect(decision.derived).toMatchObject({ ratePercent: 7, capAnchor: 1_000_000 });
  });

  it("refuses the window to an investment bank with the capability reason", () => {
    const investment = snapshot({
      charter: retail({ type: "investment", npcDeposits: 0, totalDeposits: 0 }),
    });
    expect(decide({ type: "draw_discount_window", amount: 1 }, investment)).toMatchObject({
      allowed: false,
      refusal: { code: "capability", capability: "discountWindow", denial: "charter_type" },
      message: "An investment bank cannot draw on the discount window.",
    });
  });

  it("refuses a draw past the window cap and names the headroom", () => {
    expect(decide({ type: "draw_discount_window", amount: 1_000_001 })).toMatchObject({
      allowed: false,
      refusal: { code: "cap", cap: "discountWindow", max: 1_000_000 },
    });
  });

  it("burns a window repayment and never repays more than is outstanding", () => {
    const drawn = snapshot({ charter: retail({ discountWindowDebt: 50_000 }) });
    const decision = balanced(decide({ type: "repay_discount_window", amount: 80_000 }, drawn));
    expect(decision.transition.legs.map((l) => [l.kind, l.amount])).toEqual([
      ["debit", 50_000],
      ["burn", 50_000],
    ]);
    expect(decision.derived).toEqual({ repaid: 50_000, outstandingAfter: 0 });
  });

  it("caps the margin line at half the prop book mark, arrears included", () => {
    const universal = snapshot({
      charter: retail({
        type: "universal",
        propBookMarkValue: 1_000_000,
        cbMarginDebt: 400_000,
        cbMarginArrears: 50_000,
      }),
    });
    expect(decide({ type: "draw_cb_margin", amount: 60_000 }, universal)).toMatchObject({
      allowed: false,
      refusal: { code: "cap", cap: "cbMarginCollateral", max: 50_000 },
    });
    const decision = balanced(decide({ type: "draw_cb_margin", amount: 50_000 }, universal));
    expect(decision.transition.legs.map((l) => l.kind)).toEqual(["mint", "credit"]);
  });

  it("denies every facility when banking is off, with the switch as the reason", () => {
    const off = snapshot({ policy: resolveBankingPolicy(null) });
    for (const command of [
      { type: "draw_discount_window", amount: 1 },
      { type: "draw_cb_margin", amount: 1 },
      { type: "inject_capital", amount: 1 },
    ] as const) {
      expect(decide(command, off)).toMatchObject({
        allowed: false,
        refusal: { code: "capability", denial: "banking_disabled" },
      });
    }
  });
});

describe("named loan origination", () => {
  const borrower = {
    type: "corporation" as const,
    id: OTHER,
    incomePerTurn: 200_000,
    committedPaymentPerTurn: 0,
    blocked: false,
    currencyMatches: true,
  };

  it("funds the loan from the vault, credits the borrower and books the loan", () => {
    const decision = balanced(
      decide({
        type: "originate_named_loan",
        loanId: LOAN,
        borrower,
        principal: 100_000,
        termTurns: 48,
      })
    );
    const { transition } = decision;
    expect(transition.key).toBe(`named_loan_origination:${BANK}:${LOAN}`);
    expect(transition.legs.map((l) => [l.kind, l.amount, l.collection, l.path])).toEqual([
      ["debit", 100_000, "corporations", "bankCharter.cashReserves"],
      ["credit", 100_000, "corporations", "liquidCapital"],
    ]);
    expect(transition.projections[0]).toMatchObject({
      collection: "bankLoans",
      insert: { status: "current", principal: 100_000, ratePercent: 6, termTurns: 48 },
    });
    expect(transition.projections[1].update).toEqual({
      $inc: { "bankCharter.totalLoans": 100_000 },
    });
    expect(decision.derived).toMatchObject({ ratePercent: 6, pending: false });
  });

  it("parks the loan as pending with no legs when the bank requires approval", () => {
    const approval = snapshot({ charter: retail({ requireApproval: true }) });
    const decision = balanced(
      decide(
        { type: "originate_named_loan", loanId: LOAN, borrower, principal: 100_000, termTurns: 48 },
        approval
      )
    );
    expect(decision.transition.legs).toEqual([]);
    expect(decision.transition.projections).toHaveLength(1);
    expect(decision.transition.projections[0].insert).toMatchObject({ status: "pending" });
    expect(decision.transition.event.statusAfter).toBe("pending");
  });

  it("adds the character spread and refuses a character at an investment bank", () => {
    const person = { ...borrower, type: "character" as const };
    const decision = balanced(
      decide({
        type: "originate_named_loan",
        loanId: LOAN,
        borrower: person,
        principal: 10_000,
        termTurns: 48,
      })
    );
    expect(decision.derived).toMatchObject({ ratePercent: 7.5 });
    expect(decision.transition.legs[1].path).toBe("currencyBalances.personal.USD");

    const investment = snapshot({
      charter: retail({ type: "investment", npcDeposits: 0, totalDeposits: 0, totalLoans: 0 }),
    });
    expect(
      decide(
        {
          type: "originate_named_loan",
          loanId: LOAN,
          borrower: person,
          principal: 10_000,
          termTurns: 48,
        },
        investment
      )
    ).toMatchObject({
      allowed: false,
      refusal: { code: "capability", capability: "namedCharacterLending" },
    });
  });

  it("names the binding cap when the principal is too large", () => {
    // headroom = 4M * 0.9 - 2M = 1.6M; cash 1M binds first.
    expect(
      decide({
        type: "originate_named_loan",
        loanId: LOAN,
        borrower,
        principal: 1_500_000,
        termTurns: 48,
      })
    ).toMatchObject({
      allowed: false,
      refusal: { code: "cap", cap: "cashReserves", max: 1_000_000 },
      message: "Principal exceeds the bank's cash reserves (max 1000000)",
    });
    const poor = { ...borrower, incomePerTurn: 1_000 };
    expect(
      decide({
        type: "originate_named_loan",
        loanId: LOAN,
        borrower: poor,
        principal: 100_000,
        termTurns: 48,
      })
    ).toMatchObject({ allowed: false, refusal: { code: "cap", cap: "income" } });
  });

  it("refuses self-lending, blacklisted borrowers, currency mismatches and bad terms", () => {
    const self = { ...borrower, id: BANK };
    expect(
      decide({
        type: "originate_named_loan",
        loanId: LOAN,
        borrower: self,
        principal: 1,
        termTurns: 48,
      })
    ).toMatchObject({ refusal: { code: "state", detail: "self" } });
    expect(
      decide({
        type: "originate_named_loan",
        loanId: LOAN,
        borrower: { ...borrower, blocked: true },
        principal: 1,
        termTurns: 48,
      })
    ).toMatchObject({ refusal: { code: "state", detail: "blacklisted" } });
    expect(
      decide({
        type: "originate_named_loan",
        loanId: LOAN,
        borrower: { ...borrower, currencyMatches: false },
        principal: 1,
        termTurns: 48,
      })
    ).toMatchObject({ refusal: { code: "state", detail: "currency" } });
    expect(
      decide({ type: "originate_named_loan", loanId: LOAN, borrower, principal: 1, termTurns: 3 })
    ).toMatchObject({ refusal: { code: "state", detail: "term" } });
  });
});

describe("pending loan decisions", () => {
  it("funds a pending loan from the vault and flips it to current, guarded on pending", () => {
    const decision = balanced(
      decide({
        type: "disburse_pending_loan",
        loanId: LOAN,
        borrower: { type: "corporation", id: OTHER, blocked: false },
        principal: 50_000,
      })
    );
    expect(decision.transition.key).toBe(`named_loan_disbursement:${BANK}:${LOAN}`);
    expect(decision.transition.legs.map((l) => [l.kind, l.path])).toEqual([
      ["debit", "bankCharter.cashReserves"],
      ["credit", "liquidCapital"],
    ]);
    expect(decision.transition.projections[0]).toMatchObject({
      collection: "bankLoans",
      filter: { status: "pending" },
      update: { $set: { status: "current", decisionTurn: 200 } },
    });
    expect(decision.transition.event.kind).toBe("loan.approved");
  });

  it("re-checks headroom and the blacklist at decision time", () => {
    expect(
      decide({
        type: "disburse_pending_loan",
        loanId: LOAN,
        borrower: { type: "corporation", id: OTHER, blocked: false },
        principal: 1_700_000,
      })
    ).toMatchObject({ allowed: false, refusal: { code: "cap", cap: "headroom" } });
    expect(
      decide({
        type: "disburse_pending_loan",
        loanId: LOAN,
        borrower: { type: "corporation", id: OTHER, blocked: true },
        principal: 1,
      })
    ).toMatchObject({ allowed: false, refusal: { code: "state", detail: "blacklisted" } });
  });

  it("rejects a pending loan with no legs and an optional trimmed reason", () => {
    const decision = balanced(
      decide({ type: "reject_pending_loan", loanId: LOAN, reason: "  too risky  " })
    );
    expect(decision.transition.legs).toEqual([]);
    expect(decision.transition.projections[0].update).toEqual({
      $set: { status: "rejected", decisionTurn: 200, rejectedReason: "too risky" },
    });
    expect(decision.transition.event.kind).toBe("loan.rejected");
  });
});

describe("interbank market", () => {
  const investment: BankCharterSnapshot = retail({
    type: "investment",
    currency: "USD",
    npcDeposits: 0,
    totalDeposits: 0,
    totalLoans: 0,
  });

  it("lends within half of lendable headroom and moves cash between vaults", () => {
    const decision = balanced(
      decide({
        type: "lend_interbank",
        loanId: LOAN,
        borrowerBankId: OTHER,
        borrowerCharter: investment,
        amount: 500_000,
        ratePercent: 5,
        lenderOutstanding: 0,
      })
    );
    expect(decision.transition.legs.map((l) => [l.kind, l.path])).toEqual([
      ["debit", "bankCharter.cashReserves"],
      ["credit", "bankCharter.cashReserves"],
    ]);
    expect(decision.transition.projections[1].update).toEqual({
      $inc: { "bankCharter.interbankDebt": 500_000 },
    });
  });

  it("refuses beyond the interbank share, counting what is already out", () => {
    // headroom 1.6M, share 0.8M
    expect(
      decide({
        type: "lend_interbank",
        loanId: LOAN,
        borrowerBankId: OTHER,
        borrowerCharter: investment,
        amount: 500_000,
        ratePercent: 5,
        lenderOutstanding: 400_000,
      })
    ).toMatchObject({
      allowed: false,
      refusal: { code: "cap", cap: "interbankShare", max: 400_000 },
    });
  });

  it("refuses a retail borrower and a currency mismatch", () => {
    expect(
      decide({
        type: "lend_interbank",
        loanId: LOAN,
        borrowerBankId: OTHER,
        borrowerCharter: retail(),
        amount: 1,
        ratePercent: 5,
        lenderOutstanding: 0,
      })
    ).toMatchObject({ refusal: { code: "capability", capability: "interbankBorrowing" } });
    expect(
      decide({
        type: "lend_interbank",
        loanId: LOAN,
        borrowerBankId: OTHER,
        borrowerCharter: { ...investment, currency: "GBP" },
        amount: 1,
        ratePercent: 5,
        lenderOutstanding: 0,
      })
    ).toMatchObject({ refusal: { code: "state", detail: "currency" } });
  });

  it("repays no more than is outstanding and closes the loan at zero", () => {
    const borrowerSnap = snapshot({ charter: investment, bankId: OTHER });
    const decision = balanced(
      decide(
        {
          type: "repay_interbank",
          loanId: LOAN,
          lenderBankId: BANK,
          outstanding: 300_000,
          amount: 900_000,
        },
        borrowerSnap
      )
    );
    expect(decision.transition.legs[0].amount).toBe(300_000);
    expect(decision.transition.projections[1].update).toEqual({
      $set: { outstanding: 0, status: "repaid", arrearsTurns: 0 },
    });
    expect(decision.transition.event.statusAfter).toBe("repaid");
  });
});

describe("every allowed transition", () => {
  it("balances, carries the snapshot's turn and currency, and has an event", () => {
    const commands: BankCommand[] = [
      { type: "inject_capital", amount: 1_000 },
      { type: "draw_discount_window", amount: 1_000 },
      {
        type: "originate_named_loan",
        loanId: LOAN,
        borrower: {
          type: "corporation",
          id: OTHER,
          incomePerTurn: 100_000,
          committedPaymentPerTurn: 0,
          blocked: false,
          currencyMatches: true,
        },
        principal: 10_000,
        termTurns: 12,
      },
    ];
    for (const command of commands) {
      const decision = balanced(decide(command));
      expect(decision.transition.turn).toBe(200);
      expect(decision.transition.currency).toBe("USD");
      expect(decision.transition.event.command).toMatch(/^bank\./);
      for (const leg of decision.transition.legs) {
        expect(leg.amount).toBeGreaterThan(0);
        if (leg.kind === "debit" || leg.kind === "credit") {
          expect(leg.collection).toBeTruthy();
          expect(leg.path).toBeTruthy();
          expect(leg.filter).toBeTruthy();
        }
      }
    }
  });
});
