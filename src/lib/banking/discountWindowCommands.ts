/**
 * Draw on and repay the discount window.
 *
 * Drawing CREATES money at the central bank, exactly as the CB margin line
 * does: the bank's ring-fenced cash rises and the central bank's balance sheet
 * carries the claim. Repayment destroys it symmetrically. Both are decided by
 * the rules boundary and landed by the settlement journal as one transition
 * (mint or burn leg, vault leg, the debt counter, the central bank's creation
 * counter), so a crash can no longer leave the cash without the claim.
 */

import { ObjectId, type Db } from "mongodb";
import type { CentralBank, Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { emitTx } from "@/lib/financialTxLog/emit";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";
import { loadBankingSnapshot } from "@/lib/banking/snapshot";
import { decideBankCommand } from "@/lib/banking/rules/decide";
import { settleTransition } from "@/lib/banking/settlementJournal";
import { charterMay } from "@/lib/banking/rules/capabilities";
import { discountWindowRatePercent, quoteDiscountWindow } from "./discountWindow";

export type WindowResult =
  | { ok: false; error: string; status: number }
  | { ok: true; outstanding: number; ratePercent: number };

async function primeRateFor(db: Db, currency: CurrencyCode): Promise<number> {
  const cb = await db
    .collection<CentralBank>("centralBanks")
    .findOne(
      { _id: getBankId(getCountryIdForCurrency(currency)) },
      { projection: { primeRate: 1 } }
    );
  return typeof cb?.primeRate === "number" && Number.isFinite(cb.primeRate) ? cb.primeRate : 0;
}

async function runWindowCommand(
  db: Db,
  corporationId: ObjectId,
  command: { type: "draw_discount_window" | "repay_discount_window"; amount: number },
  currentTurn: number,
  txType: "bank_discount_window_draw" | "bank_discount_window_repay"
): Promise<WindowResult> {
  const loaded = await loadBankingSnapshot(db, corporationId, { turn: currentTurn });
  const charter = loaded?.snapshot.charter;
  if (!loaded || !charter) return { ok: false, error: "No bank charter", status: 404 };
  const { snapshot, corporation } = loaded;
  const commandName =
    command.type === "draw_discount_window"
      ? "bank.discountWindow.draw"
      : "bank.discountWindow.repay";

  const decision = decideBankCommand(snapshot, command, {
    commandId: new ObjectId().toHexString(),
  });
  if (!decision.allowed) {
    emitBankingAuditEvent(
      {
        kind: "charter.issued",
        command: commandName,
        turn: currentTurn,
        outcome: "rejected",
        reason: decision.message,
        currency: snapshot.currency,
        bankId: corporationId.toString(),
        meta: { amount: command.amount },
      },
      db
    );
    return { ok: false, error: decision.message, status: 400 };
  }

  const settled = await settleTransition(db, decision.transition);
  if (settled.status === "rejected" || settled.status === "partial" || settled.error) {
    emitBankingAuditEvent(
      {
        ...decision.transition.event,
        turn: currentTurn,
        outcome: "rejected",
        reason: settled.error ?? "settlement did not complete",
        currency: snapshot.currency,
        bankId: corporationId.toString(),
        settlementId: decision.transition.key,
      },
      db
    );
    return {
      ok: false,
      error:
        command.type === "draw_discount_window"
          ? "This draw would take the bank past its window limit. A bank needing more than that is not illiquid, it is insolvent."
          : "Insufficient cash to repay that amount.",
      status: 409,
    };
  }

  const amount = decision.transition.legs.find(
    (l) => l.kind === "credit" || l.kind === "debit"
  )?.amount;
  const moved = amount ?? 0;
  const now = new Date();
  const currency = snapshot.currency as CurrencyCode;
  const ratePercent = discountWindowRatePercent(snapshot.primeRate);

  await emitTx(db, {
    type: txType,
    turn: currentTurn,
    createdAt: now,
    subjectType: "corporation",
    subjectId: corporationId,
    subjectName: corporation.name,
    amount: command.type === "draw_discount_window" ? moved : -moved,
    currencyCode: currency,
    counterpartyType: "government",
    counterpartyName: `${getCountryIdForCurrency(currency)} central bank`,
    meta:
      command.type === "draw_discount_window"
        ? { kind: "discount_window_draw", ratePercent }
        : { kind: "discount_window_repay" },
  });

  emitBankingAuditEvent(
    {
      ...decision.transition.event,
      turn: currentTurn,
      outcome: "ok",
      currency,
      bankId: corporationId.toString(),
      settlementId: decision.transition.key,
    },
    db
  );

  const before = Math.max(0, charter.discountWindowDebt ?? 0);
  return {
    ok: true,
    outstanding: command.type === "draw_discount_window" ? before + moved : before - moved,
    ratePercent,
  };
}

export async function drawDiscountWindow(
  db: Db,
  corporationId: ObjectId,
  amount: number,
  currentTurn: number
): Promise<WindowResult> {
  return runWindowCommand(
    db,
    corporationId,
    { type: "draw_discount_window", amount },
    currentTurn,
    "bank_discount_window_draw"
  );
}

export async function repayDiscountWindow(
  db: Db,
  corporationId: ObjectId,
  amount: number,
  currentTurn: number
): Promise<WindowResult> {
  return runWindowCommand(
    db,
    corporationId,
    { type: "repay_discount_window", amount },
    currentTurn,
    "bank_discount_window_repay"
  );
}

/** Read-only quote for the UI. */
export async function quoteWindowForCorp(
  db: Db,
  corp: Pick<Corporation, "bankCharter">
): Promise<{ capAnchor: number; headroomAnchor: number; ratePercent: number } | null> {
  const charter = corp.bankCharter;
  if (!charter || !charterMay(charter, "discountWindow")) return null;
  const prime = await primeRateFor(db, charter.currency as CurrencyCode);
  return quoteDiscountWindow(charter, prime);
}
