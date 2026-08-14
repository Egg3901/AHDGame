/**
 * Draw on and repay the discount window.
 *
 * Drawing CREATES money at the central bank, exactly as the CB margin line
 * does: the bank's ring-fenced cash rises and the central bank's balance sheet carries the
 * claim. Repayment destroys it symmetrically. Both legs are ledgered so the
 * money-supply reconciliation sees the same event the bank does.
 */

import { ObjectId, type Db } from "mongodb";
import type { CentralBank, Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { emitTx } from "@/lib/financialTxLog/emit";
import { recordAudit } from "@/lib/audit/recordAudit";
import { canDraw, discountWindowRatePercent, quoteDiscountWindow } from "./discountWindow";

export type WindowResult =
  | { ok: false; error: string; status: number }
  | { ok: true; outstanding: number; ratePercent: number };

const DENIAL_MESSAGE: Record<string, string> = {
  charter_inactive: "This bank has no active charter.",
  not_deposit_taking:
    "The discount window protects depositors, so it is open to deposit-taking charters only. An investment bank funds itself on the margin line.",
  no_deposits: "The window is sized against the deposit base, and this bank has none.",
  cap_exhausted:
    "This draw would take the bank past its window limit. A bank needing more than that is not illiquid, it is insolvent.",
  invalid_amount: "Draw amount must be a positive number.",
};

async function primeRateFor(db: Db, currency: CurrencyCode): Promise<number> {
  const cb = await db
    .collection<CentralBank>("centralBanks")
    .findOne(
      { _id: getBankId(getCountryIdForCurrency(currency)) },
      { projection: { primeRate: 1 } }
    );
  return typeof cb?.primeRate === "number" && Number.isFinite(cb.primeRate) ? cb.primeRate : 0;
}

export async function drawDiscountWindow(
  db: Db,
  corporationId: ObjectId,
  amount: number,
  currentTurn: number
): Promise<WindowResult> {
  const corp = await db.collection<Corporation>("corporations").findOne({ _id: corporationId });
  if (!corp?.bankCharter) return { ok: false, error: "No bank charter", status: 404 };
  const charter = corp.bankCharter;
  const currency = charter.currency as CurrencyCode;
  const prime = await primeRateFor(db, currency);

  const allowed = canDraw(charter, amount, prime);
  if (!allowed.ok)
    return {
      ok: false,
      status: allowed.reason === "charter_inactive" ? 400 : 400,
      error: DENIAL_MESSAGE[allowed.reason] ?? "Draw refused.",
    };

  const draw = Math.round(amount);
  const now = new Date();

  // Guard the cap in the write itself, so two draws in the same instant cannot
  // both pass the read-side check and take the bank over its limit.
  const claim = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: corporationId,
      "bankCharter.status": "active",
      $expr: {
        $lte: [
          { $add: [{ $ifNull: ["$bankCharter.discountWindowDebt", 0] }, draw] },
          allowed.quote.capAnchor,
        ],
      },
    },
    {
      $inc: { "bankCharter.cashReserves": draw, "bankCharter.discountWindowDebt": draw },
      $set: { updatedAt: now },
    }
  );
  if (claim.modifiedCount === 0)
    return { ok: false, error: DENIAL_MESSAGE.cap_exhausted, status: 409 };

  // Money created at the central bank, mirroring the margin line.
  await db
    .collection<CentralBank>("centralBanks")
    .updateOne(
      { _id: getBankId(getCountryIdForCurrency(currency)) },
      { $inc: { netMoneyCreatedLifetime: draw }, $set: { updatedAt: now } }
    );

  await emitTx(db, {
    type: "bank_discount_window_draw",
    turn: currentTurn,
    createdAt: now,
    subjectType: "corporation",
    subjectId: corporationId,
    subjectName: corp.name,
    amount: draw,
    currencyCode: currency,
    counterpartyType: "government",
    counterpartyName: `${getCountryIdForCurrency(currency)} central bank`,
    meta: { kind: "discount_window_draw", ratePercent: discountWindowRatePercent(prime) },
  });

  recordAudit({
    source: "api",
    action: "bank.discountWindow.draw",
    category: "money",
    turn: currentTurn,
    ts: now,
    subject: { type: "corporation", id: corporationId, name: corp.name },
    refs: { corporationId },
    outcome: "ok",
    meta: { amount: draw, ratePercent: discountWindowRatePercent(prime) },
  });

  return {
    ok: true,
    outstanding: (charter.discountWindowDebt ?? 0) + draw,
    ratePercent: discountWindowRatePercent(prime),
  };
}

export async function repayDiscountWindow(
  db: Db,
  corporationId: ObjectId,
  amount: number,
  currentTurn: number
): Promise<WindowResult> {
  const corp = await db.collection<Corporation>("corporations").findOne({ _id: corporationId });
  if (!corp?.bankCharter) return { ok: false, error: "No bank charter", status: 404 };
  const charter = corp.bankCharter;
  const outstanding = Math.max(0, charter.discountWindowDebt ?? 0);
  if (outstanding <= 0)
    return { ok: false, error: "Nothing is outstanding on the window.", status: 400 };

  const currency = charter.currency as CurrencyCode;
  const repay = Math.min(Math.round(amount), outstanding);
  if (!(repay > 0)) return { ok: false, error: "Repayment must be positive.", status: 400 };

  const now = new Date();
  const claim = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: corporationId,
      "bankCharter.cashReserves": { $gte: repay },
      "bankCharter.discountWindowDebt": { $gte: repay },
    },
    {
      $inc: { "bankCharter.cashReserves": -repay, "bankCharter.discountWindowDebt": -repay },
      $set: { updatedAt: now },
    }
  );
  if (claim.modifiedCount === 0)
    return { ok: false, error: "Insufficient cash to repay that amount.", status: 400 };

  // Repayment destroys the money the draw created.
  await db
    .collection<CentralBank>("centralBanks")
    .updateOne(
      { _id: getBankId(getCountryIdForCurrency(currency)) },
      { $inc: { netMoneyCreatedLifetime: -repay }, $set: { updatedAt: now } }
    );

  await emitTx(db, {
    type: "bank_discount_window_repay",
    turn: currentTurn,
    createdAt: now,
    subjectType: "corporation",
    subjectId: corporationId,
    subjectName: corp.name,
    amount: -repay,
    currencyCode: currency,
    counterpartyType: "government",
    counterpartyName: `${getCountryIdForCurrency(currency)} central bank`,
    meta: { kind: "discount_window_repay" },
  });

  return {
    ok: true,
    outstanding: outstanding - repay,
    ratePercent: discountWindowRatePercent(await primeRateFor(db, currency)),
  };
}

/** Read-only quote for the UI. */
export async function quoteWindowForCorp(
  db: Db,
  corp: Pick<Corporation, "bankCharter">
): Promise<{ capAnchor: number; headroomAnchor: number; ratePercent: number } | null> {
  const charter = corp.bankCharter;
  if (!charter || charter.status !== "active" || charter.type === "investment") return null;
  const prime = await primeRateFor(db, charter.currency as CurrencyCode);
  return quoteDiscountWindow(charter, prime);
}
