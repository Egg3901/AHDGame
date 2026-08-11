import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";

/** Ledger insert shape (emit fills _id / expiresAt / flagged). */
type EscrowTxInput = Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">;

interface EscrowEntryBase {
  corpId: ObjectId;
  corpName: string;
  currencyCode: CurrencyCode;
  turn: number;
  createdAt: Date;
  /** Resulting escrow balance after the move, corp local currency. */
  escrowBalanceAfter: number;
}

/**
 * Per-turn escrow funding sweep (treasury → escrow). Internal, money-conserving
 * move within the corp, so counterparty is "system" and it carries no suspect
 * threshold. Amount is a NEGATIVE treasury debit. Returns null when nothing
 * moved this turn.
 */
export function buildEscrowFundingTxEntry(
  input: EscrowEntryBase & { escrowFundingMove: number }
): EscrowTxInput | null {
  if (!(input.escrowFundingMove > 0)) return null;
  return {
    type: "corp_escrow_funding",
    turn: input.turn,
    createdAt: input.createdAt,
    subjectType: "corporation",
    subjectId: input.corpId,
    subjectName: input.corpName,
    amount: -Math.round(input.escrowFundingMove),
    currencyCode: input.currencyCode,
    counterpartyType: "system",
    meta: { escrowBalanceAfter: Math.round(input.escrowBalanceAfter) },
  };
}

/**
 * Manual escrow withdrawal (escrow → treasury). Internal, money-conserving;
 * counterparty "system", no threshold. Amount is a POSITIVE treasury credit.
 * Returns null for a non-positive amount.
 */
export function buildEscrowWithdrawalTxEntry(
  input: EscrowEntryBase & { amount: number }
): EscrowTxInput | null {
  if (!(input.amount > 0)) return null;
  return {
    type: "corp_escrow_withdrawal",
    turn: input.turn,
    createdAt: input.createdAt,
    subjectType: "corporation",
    subjectId: input.corpId,
    subjectName: input.corpName,
    amount: Math.round(input.amount),
    currencyCode: input.currencyCode,
    counterpartyType: "system",
    meta: { escrowBalanceAfter: Math.round(input.escrowBalanceAfter) },
  };
}
