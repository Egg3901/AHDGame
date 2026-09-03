/**
 * One turn of servicing on a named loan, as pure data.
 *
 * The banking turn used to compute the instalment, read the borrower, pick a
 * branch (full, partial, default) and write the loan document in four places
 * with the money move somewhere in the middle. The decision is now one
 * function of the loan, the cash the borrower can pay, and the turn; the
 * transition it returns carries the money legs, the loan-document update
 * guarded on the turn stamp, and the event. The journal lands it once.
 */

import type { BankLoan } from "@/lib/db/types/bank";
import { ARREARS_DEFAULT_TURNS, namedLoanInstalment } from "@/lib/banking/rules/loans";
import type {
  BankingTransition,
  TransitionLeg,
  TransitionProjection,
} from "@/lib/banking/rules/boundary";
import { oid } from "@/lib/banking/rules/boundary";

export type LoanServiceOutcome = "paid" | "delinquent" | "defaulted" | "closed";

export interface LoanServiceDecision {
  outcome: LoanServiceOutcome;
  /** What the borrower is charged this turn. */
  payment: number;
  interestPaid: number;
  principalPaid: number;
  /** Outstanding after the payment (before any write-off). */
  nextOutstanding: number;
  /** Principal written off on default. */
  writtenOff: number;
  status: BankLoan["status"];
  arrearsTurns: number;
  /** What the lender's cash goes up by (the payment, when it lands). */
  bankCredit: number;
  /** Change to the bank's cached loan total. */
  totalLoansDelta: number;
}

export interface LoanServiceInput {
  loan: Pick<
    BankLoan,
    | "_id"
    | "outstanding"
    | "status"
    | "ratePercent"
    | "originatedTurn"
    | "termTurns"
    | "arrearsTurns"
  >;
  /** Cash the borrower holds in the loan currency right now. */
  borrowerAvailable: number;
  turn: number;
}

/** Decide this turn's servicing without touching anything. */
export function decideLoanService(input: LoanServiceInput): LoanServiceDecision {
  const { loan, turn } = input;
  const outstanding = Math.max(0, loan.outstanding ?? 0);
  if (outstanding <= 0) {
    return {
      outcome: "closed",
      payment: 0,
      interestPaid: 0,
      principalPaid: 0,
      nextOutstanding: 0,
      writtenOff: 0,
      status: "repaid",
      arrearsTurns: 0,
      bankCredit: 0,
      totalLoansDelta: 0,
    };
  }
  const { interestDue, principalDue, paymentDue } = namedLoanInstalment(loan, turn);
  const available = Math.max(
    0,
    Number.isFinite(input.borrowerAvailable) ? input.borrowerAvailable : 0
  );
  const payment = Math.min(paymentDue, available);

  if (payment < paymentDue - 1e-9) {
    const interestPaid = Math.min(payment, interestDue);
    const principalPaid = Math.max(0, payment - interestPaid);
    const nextOutstanding = Math.max(0, outstanding - principalPaid);
    const arrearsTurns = (loan.arrearsTurns ?? 0) + 1;
    if (arrearsTurns >= ARREARS_DEFAULT_TURNS) {
      return {
        outcome: "defaulted",
        payment,
        interestPaid,
        principalPaid,
        nextOutstanding,
        writtenOff: nextOutstanding,
        status: "defaulted",
        arrearsTurns,
        bankCredit: payment,
        totalLoansDelta: -(principalPaid + nextOutstanding),
      };
    }
    return {
      outcome: "delinquent",
      payment,
      interestPaid,
      principalPaid,
      nextOutstanding,
      writtenOff: 0,
      status: "arrears",
      arrearsTurns,
      bankCredit: payment,
      totalLoansDelta: -principalPaid,
    };
  }

  const principalPaid = Math.min(principalDue, outstanding);
  const nextOutstanding = Math.max(0, outstanding - principalPaid);
  return {
    outcome: "paid",
    payment: paymentDue,
    interestPaid: interestDue,
    principalPaid,
    nextOutstanding,
    writtenOff: 0,
    status: nextOutstanding <= 0 ? "repaid" : "current",
    arrearsTurns: 0,
    bankCredit: paymentDue,
    totalLoansDelta: -principalPaid,
  };
}

export interface LoanServiceTarget {
  collection: string;
  filter: Record<string, unknown>;
  path: string;
  note: string;
}

export interface LoanServiceTransitionInput extends LoanServiceInput {
  loan: LoanServiceInput["loan"] & Pick<BankLoan, "borrowerType" | "borrowerId" | "currency">;
  /** Where the payment lands: a live bank's vault, or the estate / insurer. */
  creditTarget: LoanServiceTarget;
  bankId: string;
  decision?: LoanServiceDecision;
}

export const loanServiceKey = (loanId: string, turn: number): string =>
  `loan-service:${loanId}:${turn}`;

/**
 * The transition for one turn of servicing. Its money legs are absent when
 * nothing is payable (a closed loan, a borrower with nothing), and the
 * loan-document projection is guarded on `lastProcessedTurn` so a second
 * pass in the same turn matches nothing and advances nothing.
 */
export function loanServiceTransition(input: LoanServiceTransitionInput): {
  decision: LoanServiceDecision;
  transition: BankingTransition;
} {
  const decision = input.decision ?? decideLoanService(input);
  const { loan, turn } = input;
  const loanId = loan._id.toString();
  const borrowerId = loan.borrowerId ? loan.borrowerId.toString() : null;

  const legs: TransitionLeg[] = [];
  if (decision.payment > 0 && borrowerId) {
    legs.push({
      kind: "debit",
      amount: decision.payment,
      collection: loan.borrowerType === "character" ? "characters" : "corporations",
      filter: { _id: oid(borrowerId) },
      path:
        loan.borrowerType === "character"
          ? `currencyBalances.personal.${loan.currency}`
          : "liquidCapital",
      note: "borrower pays the instalment",
    });
    legs.push({
      kind: "credit",
      amount: decision.payment,
      collection: input.creditTarget.collection,
      filter: input.creditTarget.filter,
      path: input.creditTarget.path,
      note: input.creditTarget.note,
    });
  }

  const projections: TransitionProjection[] = [
    {
      collection: "bankLoans",
      filter: { _id: oid(loanId), lastProcessedTurn: { $ne: turn } },
      update: {
        $set: {
          outstanding:
            decision.outcome === "defaulted" ? decision.nextOutstanding : decision.nextOutstanding,
          status: decision.status,
          arrearsTurns: decision.arrearsTurns,
          lastProcessedTurn: turn,
        },
      },
      note: "the loan advances one turn",
    },
  ];

  const eventKind =
    decision.outcome === "defaulted"
      ? "loan.defaulted"
      : decision.outcome === "delinquent"
        ? "loan.delinquent"
        : "loan.paid";

  return {
    decision,
    transition: {
      key: loanServiceKey(loanId, turn),
      kind: "loan_service",
      turn,
      currency: loan.currency,
      legs,
      projections,
      event: {
        kind: eventKind,
        command: "bank.loan.service",
        subjectType: "loan",
        subjectId: loanId,
        statusBefore: loan.status,
        statusAfter: decision.status,
        amount: decision.payment,
        meta: {
          borrowerType: loan.borrowerType,
          writtenOff: decision.writtenOff,
          arrearsTurns: decision.arrearsTurns,
          interestPaid: decision.interestPaid,
          principalPaid: decision.principalPaid,
        },
      },
    },
  };
}
