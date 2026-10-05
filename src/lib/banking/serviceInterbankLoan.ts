/**
 * Interbank loan servicing pays the lender from the borrower's bank reserves.
 * serviceOneInterbankLoan journals interest, defaults and the loan advance
 * under one per-loan, per-turn key and counts only newly applied payments.
 */
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { InterbankLoan } from "@/lib/db/types/bank";
import { getCashReserves } from "@/lib/banking/bankCash";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";
import { interbankServiceTransition } from "@/lib/banking/rules/interbankServicing";
import { settleTransition } from "@/lib/banking/settlementJournal";

type InterbankServiceResult = { interestPaid: number; writtenOff: number };

/**
 * One turn of interbank interest, decided by the rules and landed by the
 * journal as one transition: borrower vault debit, lender vault credit and
 * the loan record's advance (or its default and the borrower's debt clear),
 * under the per-loan-per-turn key.
 */
export async function serviceOneInterbankLoan(
  db: Db,
  turn: number,
  loan: InterbankLoan
): Promise<InterbankServiceResult> {
  const empty: InterbankServiceResult = { interestPaid: 0, writtenOff: 0 };
  if (loan.lastProcessedTurn === turn) return empty;

  const borrower = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: loan.borrowerCorporationId }, { projection: { bankCharter: 1 } });
  const { decision, transition } = interbankServiceTransition({
    loan,
    borrowerCash: getCashReserves(borrower?.bankCharter),
    turn,
  });
  const settled = await settleTransition(db, transition);
  if (settled.status === "rejected") return empty;
  const moneyLanded =
    transition.legs.length === 0 || settled.appliedLegs.length === transition.legs.length;
  const advanced = settled.appliedProjections.length === transition.projections.length;
  if (settled.status === "applied" && advanced) {
    emitBankingAuditEvent(
      {
        ...transition.event,
        turn,
        outcome: "ok",
        currency: loan.currency,
        bankId: loan.borrowerCorporationId.toString(),
        settlementId: transition.key,
      },
      db
    );
  }
  return {
    interestPaid: moneyLanded && settled.status === "applied" ? decision.interestPaid : 0,
    writtenOff: advanced && settled.status === "applied" ? decision.writtenOff : 0,
  };
}
