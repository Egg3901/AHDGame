/**
 * The expense ratio: the sponsor's entire business model, and a real drag on
 * every unit holder's return.
 *
 * The fee moves fund cash to the sponsor corporation. It is CONSERVED — nothing
 * is minted, and both legs are ledgered — and it lands in the sponsor's
 * `liquidCapital`, so it flows into corporate profit, tax and share price like
 * any other revenue.
 *
 * Two guards make the arrangement honest rather than extractive:
 *
 *  1. **The fee stops when the holders are impaired.** Below
 *     `FEE_SUSPENDED_BELOW_BACKING_RATIO` the sponsor is paid nothing. A fund
 *     that cannot back its units is not a fund anyone should be earning from,
 *     and the suspension is what points the sponsor at fixing it.
 *  2. **A wind-up earns nothing.** Once the sponsor has decided to close the
 *     fund they stop being paid to run it, so the incentive is to wind up
 *     promptly rather than to milk a dying fund.
 */

import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { IndexFund, IndexFundTransaction } from "@/lib/db/types/indexFund";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  anchorToCorpLiquidCapital,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { creditCorpLiquidCapital } from "@/lib/financialTxLog/atomicCashGuard";
import { emitTx } from "@/lib/financialTxLog/emit";
import { expenseFeeForTurn, FEE_SUSPENDED_BELOW_BACKING_RATIO } from "./constants";

const FUND_TX = "indexFundTransactions";

export interface ExpenseFeeOutcome {
  fundsCharged: number;
  totalFeeAnchor: number;
  suspended: number;
}

/**
 * Decide the fee for one fund. Pure, so the reasons a fee was skipped are
 * testable without a database.
 */
export function feeDecision(params: {
  status: IndexFund["status"];
  expenseRatioAnnual: number | undefined;
  aumAnchor: number;
  backingRatio: number | undefined;
  cashAnchor: number;
}): { feeAnchor: number; reason?: "not_sponsored" | "winding_down" | "impaired" | "no_cash" } {
  if (!params.expenseRatioAnnual || params.expenseRatioAnnual <= 0)
    return { feeAnchor: 0, reason: "not_sponsored" };
  if (params.status !== "active") return { feeAnchor: 0, reason: "winding_down" };
  if (
    typeof params.backingRatio === "number" &&
    params.backingRatio < FEE_SUSPENDED_BELOW_BACKING_RATIO
  )
    return { feeAnchor: 0, reason: "impaired" };

  const feeAnchor = expenseFeeForTurn(params.aumAnchor, params.expenseRatioAnnual);
  if (feeAnchor <= 0) return { feeAnchor: 0 };
  // Fees come out of CASH, never by forcing a holding sale: a fund should not
  // be made to liquidate its portfolio to pay the person running it.
  if (params.cashAnchor < feeAnchor) return { feeAnchor: 0, reason: "no_cash" };
  return { feeAnchor };
}

/**
 * Charge every sponsored fund its per-turn expense fee. Called from the fund
 * cron after NAV has been recomputed, so AUM is the marked value rather than a
 * stale one.
 */
export async function chargeSponsorExpenseFees(
  db: Db,
  funds: IndexFund[],
  currentTurn: number
): Promise<ExpenseFeeOutcome> {
  const outcome: ExpenseFeeOutcome = { fundsCharged: 0, totalFeeAnchor: 0, suspended: 0 };
  const sponsored = funds.filter((f) => f.sponsorCorporationId && f.expenseRatioAnnual);
  if (sponsored.length === 0) return outcome;

  const sponsors = await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: sponsored.map((f) => f.sponsorCorporationId as ObjectId) } })
    .toArray();
  const sponsorById = new Map(sponsors.map((c) => [c._id.toString(), c]));
  const now = new Date();

  for (const fund of sponsored) {
    const sponsor = sponsorById.get(fund.sponsorCorporationId!.toString());
    // Sponsor gone (dissolved, acquired and deleted): the fund keeps running
    // for its holders and simply stops charging. Wind-up is then an admin call,
    // not something a vanished corporation can be made to do.
    if (!sponsor) continue;

    const aumAnchor = fund.cashAnchor + (fund.quotedNav ?? 0) * (fund.unitSupply ?? 0);
    const { feeAnchor, reason } = feeDecision({
      status: fund.status,
      expenseRatioAnnual: fund.expenseRatioAnnual,
      aumAnchor,
      backingRatio: fund.backingRatio,
      cashAnchor: fund.cashAnchor,
    });
    if (feeAnchor <= 0) {
      if (reason === "impaired" || reason === "no_cash") outcome.suspended += 1;
      continue;
    }

    // Debit the fund first and only credit the sponsor if it landed, so a
    // failed guard cannot mint the fee.
    const debited = await db
      .collection<IndexFund>("indexFunds")
      .updateOne(
        { _id: fund._id, cashAnchor: { $gte: feeAnchor } },
        {
          $inc: { cashAnchor: -feeAnchor, feesPaidToSponsorAnchor: feeAnchor },
          $set: { updatedAt: now },
        }
      );
    if (debited.modifiedCount === 0) {
      outcome.suspended += 1;
      continue;
    }

    const fxRate = await getCorpFxRate(db, sponsor);
    const feeLocal = Math.round(anchorToCorpLiquidCapital(feeAnchor, sponsor, fxRate));
    if (feeLocal > 0) await creditCorpLiquidCapital(db, sponsor._id, feeLocal);

    await Promise.all([
      emitTx(db, {
        type: "corp_revenue",
        turn: currentTurn,
        createdAt: now,
        subjectType: "corporation",
        subjectId: sponsor._id,
        subjectName: sponsor.name,
        amount: feeLocal,
        currencyCode: (resolveCorpLiquidCurrencyCode(sponsor) ?? "USD") as CurrencyCode,
        counterpartyType: "system",
        counterpartyName: fund.name,
        meta: {
          kind: "fund_expense_fee",
          fundId: fund._id.toString(),
          expenseRatioAnnual: fund.expenseRatioAnnual,
          aumAnchor: Math.round(aumAnchor),
        },
      }),
      db.collection<IndexFundTransaction>(FUND_TX).insertOne({
        _id: new ObjectId(),
        fundId: fund._id,
        kind: "expense_fee",
        turn: currentTurn,
        corporationId: sponsor._id,
        amountAnchor: -feeAnchor,
        note: `Expense fee to ${sponsor.name}`,
        createdAt: now,
      } as IndexFundTransaction),
    ]);

    outcome.fundsCharged += 1;
    outcome.totalFeeAnchor += feeAnchor;
  }

  return outcome;
}
