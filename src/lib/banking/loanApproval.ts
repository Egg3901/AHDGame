import type { Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BankLoan } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types/corporation";
import type { Character } from "@/lib/db/types/character";
import {
  disburseNamedLoan,
  buildFundConstituentResolver,
  namedLoanHeadroom,
} from "@/lib/banking/lending";
import { isBlockedBorrower } from "@/lib/banking/blacklist";
import { isNamedLendingCharter } from "@/lib/banking/charterKinds";
import { getReserveRequirement } from "@/lib/banking/reserves";
import { getCurrentTurn } from "@/lib/currentTurn";
import { sendSystemMail } from "@/lib/mail/systemMail";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";

export type LoanDecisionResult = { ok: true; loan: BankLoan } | { ok: false; error: string };

/**
 * Toggle a bank's opt-in loan-approval mode. When enabled, new named loans land
 * `pending` for CEO decision instead of auto-granting. Existing pending loans
 * are unaffected either way.
 */
export async function setLoanApprovalRequired(
  db: Db,
  bankCorporationId: ObjectId,
  requireApproval: boolean
): Promise<{ ok: true; requireApproval: boolean } | { ok: false; error: string }> {
  const res = await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: bankCorporationId, "bankCharter.status": "active" },
      { $set: { "bankCharter.requireApproval": requireApproval, updatedAt: new Date() } }
    );
  if (res.matchedCount !== 1) return { ok: false, error: "No active bank charter" };
  return { ok: true, requireApproval };
}

/**
 * Resolve a mail target for a loan borrower. Characters receive mail directly;
 * corporations can't hold mail, so the corp's owning user's character is used.
 * Returns null when no character can be resolved (mail is then skipped).
 */
async function resolveBorrowerMailTarget(
  db: Db,
  loan: Pick<BankLoan, "borrowerType" | "borrowerId">
): Promise<{
  toCharacterId: ObjectId;
  toCharacterName: string;
  toCharacterSequentialId: number;
  toUserId: ObjectId;
} | null> {
  if (!loan.borrowerId) return null;
  const proj = { projection: { _id: 1, userId: 1, name: 1, sequentialId: 1 } } as const;
  if (loan.borrowerType === "character") {
    const c = await db.collection<Character>("characters").findOne({ _id: loan.borrowerId }, proj);
    if (!c?.userId) return null;
    return {
      toCharacterId: c._id,
      toCharacterName: c.name ?? "Borrower",
      toCharacterSequentialId: c.sequentialId ?? 0,
      toUserId: c.userId,
    };
  }
  const corp = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: loan.borrowerId }, { projection: { userId: 1 } });
  if (!corp?.userId) return null;
  const owner = await db.collection<Character>("characters").findOne({ userId: corp.userId }, proj);
  if (!owner?.userId) return null;
  return {
    toCharacterId: owner._id,
    toCharacterName: owner.name ?? "Borrower",
    toCharacterSequentialId: owner.sequentialId ?? 0,
    toUserId: owner.userId,
  };
}

async function notifyBorrower(
  db: Db,
  loan: BankLoan,
  bankName: string,
  subject: string,
  body: string
): Promise<void> {
  const target = await resolveBorrowerMailTarget(db, loan);
  if (!target) return;
  await sendSystemMail(db, { ...target, subject, body, senderName: bankName });
}

/**
 * CEO accepts a pending loan: re-validate against current bank state (the queue
 * may be stale — headroom or blacklist can have moved since the request), then
 * flip `pending` -> `current` and disburse via the shared lending path. The
 * status flip is guarded on `pending` so a double-accept is a no-op.
 */
export async function acceptLoan(
  db: Db,
  bankCorporationId: ObjectId,
  loanId: ObjectId
): Promise<LoanDecisionResult> {
  const result = await acceptLoanInner(db, bankCorporationId, loanId);
  emitBankingAuditEvent(
    {
      kind: "loan.approved",
      command: "bank.loan.approve",
      turn: result.ok ? (result.loan.decisionTurn ?? 0) : await getCurrentTurn(db),
      outcome: result.ok ? "ok" : "rejected",
      ...(result.ok ? {} : { reason: result.error }),
      ...(result.ok ? { currency: result.loan.currency, amount: result.loan.principal } : {}),
      bankId: bankCorporationId.toString(),
      subjectType: "loan",
      subjectId: loanId.toString(),
      statusBefore: "pending",
      ...(result.ok ? { statusAfter: "current" } : {}),
    },
    db
  );
  return result;
}

async function acceptLoanInner(
  db: Db,
  bankCorporationId: ObjectId,
  loanId: ObjectId
): Promise<LoanDecisionResult> {
  const loan = await db.collection<BankLoan>("bankLoans").findOne({
    _id: loanId,
    bankCorporationId,
  });
  if (!loan) return { ok: false, error: "Loan not found" };
  if (loan.status !== "pending") return { ok: false, error: "Loan is not pending" };

  const bankCorp = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: bankCorporationId });
  if (!bankCorp) return { ok: false, error: "Bank corporation not found" };
  const charter = bankCorp.bankCharter;
  if (!isNamedLendingCharter(charter)) {
    return { ok: false, error: "Bank no longer has an active lending charter" };
  }

  // Re-check headroom and blacklist at decision time.
  const reserveRatio = await getReserveRequirement(db, charter.currency as CurrencyCode);
  const headroom = namedLoanHeadroom(charter, reserveRatio);
  if (loan.outstanding > headroom) {
    return { ok: false, error: "Insufficient lendable headroom to fund this loan now" };
  }
  const resolveFunds = await buildFundConstituentResolver(db, charter.blacklist?.indexFundIds);
  const blocked =
    loan.borrowerType === "character"
      ? isBlockedBorrower(charter, { characterId: loan.borrowerId?.toString() }, resolveFunds)
      : isBlockedBorrower(charter, { corporationId: loan.borrowerId?.toString() }, resolveFunds);
  if (blocked) return { ok: false, error: "Borrower is on the bank's blacklist" };

  const decisionTurn = await getCurrentTurn(db);
  // Claim the loan for disbursement (idempotency guard on `pending`).
  const claim = await db
    .collection<BankLoan>("bankLoans")
    .updateOne({ _id: loanId, status: "pending" }, { $set: { status: "current", decisionTurn } });
  if (claim.matchedCount !== 1) return { ok: false, error: "Loan is not pending" };

  const borrowerName =
    loan.borrowerType === "character"
      ? ((
          await db
            .collection<Character>("characters")
            .findOne({ _id: loan.borrowerId }, { projection: { name: 1 } })
        )?.name ?? "Borrower")
      : ((
          await db
            .collection<Corporation>("corporations")
            .findOne({ _id: loan.borrowerId }, { projection: { name: 1 } })
        )?.name ?? "Borrower");

  const disbursed = await disburseNamedLoan(db, {
    loan,
    bankCorporationId,
    bankName: bankCorp.name,
    borrowerName,
  });
  if (!disbursed.ok) {
    // Roll the status back so the CEO can retry once headroom recovers.
    await db
      .collection<BankLoan>("bankLoans")
      .updateOne({ _id: loanId }, { $set: { status: "pending" }, $unset: { decisionTurn: "" } });
    return disbursed;
  }

  await notifyBorrower(
    db,
    loan,
    bankCorp.name,
    `Loan approved by ${bankCorp.name}`,
    `Your loan request for ${loan.principal.toLocaleString()} ${loan.currency} has been approved and the funds have been disbursed at ${loan.ratePercent}% over ${loan.termTurns} turns.`
  );

  return { ok: true, loan: { ...loan, status: "current", decisionTurn } };
}

/**
 * CEO rejects a pending loan: terminal `rejected`, no money moves. Guarded on
 * `pending` for idempotency. The borrower is notified with the optional reason.
 */
export async function rejectLoan(
  db: Db,
  bankCorporationId: ObjectId,
  loanId: ObjectId,
  reason?: string
): Promise<LoanDecisionResult> {
  const result = await rejectLoanInner(db, bankCorporationId, loanId, reason);
  emitBankingAuditEvent(
    {
      kind: "loan.rejected",
      command: "bank.loan.reject",
      turn: result.ok ? (result.loan.decisionTurn ?? 0) : await getCurrentTurn(db),
      outcome: result.ok ? "ok" : "rejected",
      ...(result.ok ? {} : { reason: result.error }),
      ...(result.ok ? { currency: result.loan.currency, amount: result.loan.principal } : {}),
      bankId: bankCorporationId.toString(),
      subjectType: "loan",
      subjectId: loanId.toString(),
      statusBefore: "pending",
      ...(result.ok ? { statusAfter: "rejected" } : {}),
    },
    db
  );
  return result;
}

async function rejectLoanInner(
  db: Db,
  bankCorporationId: ObjectId,
  loanId: ObjectId,
  reason?: string
): Promise<LoanDecisionResult> {
  const loan = await db.collection<BankLoan>("bankLoans").findOne({
    _id: loanId,
    bankCorporationId,
  });
  if (!loan) return { ok: false, error: "Loan not found" };
  if (loan.status !== "pending") return { ok: false, error: "Loan is not pending" };

  const bankCorp = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: bankCorporationId }, { projection: { name: 1 } });
  const bankName = bankCorp?.name ?? "The bank";

  const decisionTurn = await getCurrentTurn(db);
  const trimmed = (reason ?? "").trim().slice(0, 280);
  const res = await db.collection<BankLoan>("bankLoans").updateOne(
    { _id: loanId, status: "pending" },
    {
      $set: {
        status: "rejected",
        decisionTurn,
        ...(trimmed ? { rejectedReason: trimmed } : {}),
      },
    }
  );
  if (res.matchedCount !== 1) return { ok: false, error: "Loan is not pending" };

  await notifyBorrower(
    db,
    loan,
    bankName,
    `Loan declined by ${bankName}`,
    `Your loan request for ${loan.principal.toLocaleString()} ${loan.currency} was declined.${
      trimmed ? ` Reason: ${trimmed}` : ""
    }`
  );

  return { ok: true, loan: { ...loan, status: "rejected", decisionTurn } };
}
