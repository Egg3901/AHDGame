/**
 * One turn of interest on an interbank loan, as pure data.
 *
 * Interest-only: principal returns through `repay_interbank`. A shortfall
 * counts an arrears turn; the ARREARS_DEFAULT_TURNS-th shortfall defaults the
 * loan, which writes the lender's asset off and clears the borrower's debt
 * without any cash moving. Both sides are banks, so both legs are vault cash.
 */

import type { InterbankLoan } from "@/lib/db/types/bank";
import { ARREARS_DEFAULT_TURNS, perTurnInterestOn } from "@/lib/banking/rules/loans";
import {
  oid,
  type BankingTransition,
  type TransitionProjection,
} from "@/lib/banking/rules/boundary";

export interface InterbankServiceDecision {
  outcome: "paid" | "delinquent" | "defaulted" | "closed";
  interestDue: number;
  interestPaid: number;
  writtenOff: number;
  status: InterbankLoan["status"];
  arrearsTurns: number;
}

export function decideInterbankService(input: {
  loan: Pick<InterbankLoan, "outstanding" | "ratePercent" | "arrearsTurns" | "status">;
  borrowerCash: number;
}): InterbankServiceDecision {
  const outstanding = Math.max(0, input.loan.outstanding ?? 0);
  if (outstanding <= 0) {
    return {
      outcome: "closed",
      interestDue: 0,
      interestPaid: 0,
      writtenOff: 0,
      status: "repaid",
      arrearsTurns: 0,
    };
  }
  const interestDue = perTurnInterestOn(outstanding, input.loan.ratePercent);
  const available = Math.max(0, Number.isFinite(input.borrowerCash) ? input.borrowerCash : 0);
  const interestPaid = Math.min(interestDue, available);
  if (interestPaid < interestDue - 1e-9) {
    const arrearsTurns = (input.loan.arrearsTurns ?? 0) + 1;
    if (arrearsTurns >= ARREARS_DEFAULT_TURNS) {
      return {
        outcome: "defaulted",
        interestDue,
        interestPaid,
        writtenOff: outstanding,
        status: "defaulted",
        arrearsTurns,
      };
    }
    return {
      outcome: "delinquent",
      interestDue,
      interestPaid,
      writtenOff: 0,
      status: "current",
      arrearsTurns,
    };
  }
  return {
    outcome: "paid",
    interestDue,
    interestPaid,
    writtenOff: 0,
    status: "current",
    arrearsTurns: 0,
  };
}

export const interbankServiceKey = (loanId: string, turn: number): string =>
  `interbank-interest:${loanId}:${turn}`;

export function interbankServiceTransition(input: {
  loan: Pick<
    InterbankLoan,
    | "_id"
    | "lenderCorporationId"
    | "borrowerCorporationId"
    | "currency"
    | "outstanding"
    | "ratePercent"
    | "arrearsTurns"
    | "status"
  >;
  borrowerCash: number;
  turn: number;
}): { decision: InterbankServiceDecision; transition: BankingTransition } {
  const decision = decideInterbankService(input);
  const { loan, turn } = input;
  const loanId = loan._id.toString();
  const borrower = loan.borrowerCorporationId.toString();
  const lender = loan.lenderCorporationId.toString();

  const legs: BankingTransition["legs"] = [];
  if (decision.interestPaid > 0) {
    legs.push(
      {
        kind: "debit",
        amount: decision.interestPaid,
        collection: "corporations",
        filter: { _id: oid(borrower) },
        path: "bankCharter.cashReserves",
        note: "borrowing bank pays interbank interest",
      },
      {
        kind: "credit",
        amount: decision.interestPaid,
        collection: "corporations",
        filter: { _id: oid(lender) },
        path: "bankCharter.cashReserves",
        note: "lending bank receives interbank interest",
      }
    );
  }

  const projections: TransitionProjection[] = [];
  if (decision.outcome === "closed") {
    projections.push({
      collection: "interbankLoans",
      filter: { _id: oid(loanId), lastProcessedTurn: { $ne: turn } },
      update: {
        $set: { status: "repaid", outstanding: 0, lastProcessedTurn: turn, arrearsTurns: 0 },
      },
      note: "interbank loan closed",
    });
  } else if (decision.outcome === "defaulted") {
    // Write-off: no cash moves for the remaining principal; the borrower's
    // debt is cleared and the lender's asset dies with the loan.
    projections.push(
      {
        collection: "corporations",
        filter: { _id: oid(borrower) },
        update: { $inc: { "bankCharter.interbankDebt": -Math.max(0, loan.outstanding ?? 0) } },
        note: "borrower's defaulted interbank debt cleared",
      },
      {
        collection: "interbankLoans",
        filter: { _id: oid(loanId), lastProcessedTurn: { $ne: turn } },
        update: {
          $set: {
            status: "defaulted",
            outstanding: Math.max(0, loan.outstanding ?? 0),
            arrearsTurns: decision.arrearsTurns,
            lastProcessedTurn: turn,
          },
        },
        note: "interbank loan defaulted",
      }
    );
  } else {
    projections.push({
      collection: "interbankLoans",
      filter: { _id: oid(loanId), lastProcessedTurn: { $ne: turn } },
      update: { $set: { arrearsTurns: decision.arrearsTurns, lastProcessedTurn: turn } },
      note: "interbank loan advances one turn",
    });
  }

  return {
    decision,
    transition: {
      key: interbankServiceKey(loanId, turn),
      kind: "interbank_interest",
      turn,
      currency: loan.currency,
      legs,
      projections,
      event: {
        kind:
          decision.outcome === "defaulted"
            ? "loan.defaulted"
            : decision.outcome === "delinquent"
              ? "loan.delinquent"
              : "loan.paid",
        command: "bank.interbank.service",
        subjectType: "interbankLoan",
        subjectId: loanId,
        statusBefore: loan.status,
        statusAfter: decision.status,
        amount: decision.interestPaid,
        meta: {
          writtenOff: decision.writtenOff,
          arrearsTurns: decision.arrearsTurns,
          counterpartyBankId: lender,
        },
      },
    },
  };
}
