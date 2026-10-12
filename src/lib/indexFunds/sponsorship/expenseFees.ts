/** Sponsor fees transfer marked fund backing to corporate income once per turn. */
import { ObjectId, type Db } from "mongodb";
import type { Corporation, IndexFund, IndexFundTransaction } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  anchorToCorpLiquidCapital,
  loadFxRatesRecord,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { withSessionDb } from "@/lib/db/sessionDb";
import { emitTx } from "@/lib/financialTxLog/emit";
import { sumFundBondHoldingsByFundId } from "@/lib/bonds/fundBondHoldings";
import { loadOpenOrdersEscrowByFundId, loadQueuedRedemptionUnitsByFundId } from "../fundValuation";
import { computeHoldingsValueAnchor } from "../fundAllocation";
import { feeDecision, markedFundBacking } from "./rules/accounting";
export { feeDecision } from "./rules/accounting";

export interface ExpenseFeeOutcome {
  fundsCharged: number;
  totalFeeAnchor: number;
  suspended: number;
}

/**
 * Required transaction: fee receipts, both cash legs and the replay guard commit
 * together. A standalone database refuses this operation without moving money.
 * All books are reloaded in one snapshot rather than using stale quoted NAV.
 */
export async function chargeSponsorExpenseFees(
  db: Db,
  funds: IndexFund[],
  currentTurn: number
): Promise<ExpenseFeeOutcome> {
  const ids = funds
    .filter((fund) => fund.sponsorCorporationId && fund.expenseRatioAnnual)
    .map((fund) => fund._id);
  const empty: ExpenseFeeOutcome = { fundsCharged: 0, totalFeeAnchor: 0, suspended: 0 };
  if (!ids.length) return empty;
  const now = new Date();
  return withSessionDb(db, async (tx) => {
    const outcome = { ...empty };
    const current = await tx
      .collection<IndexFund>("indexFunds")
      .find(
        {
          _id: { $in: ids },
          status: "active",
          $or: [
            { lastExpenseFeeTurn: { $exists: false } },
            { lastExpenseFeeTurn: { $lt: currentTurn } },
          ],
        },
        { projection: { floatSettlementPlan: 0 } }
      )
      .toArray();
    if (!current.length) return outcome;
    const sponsors = await tx
      .collection<Corporation>("corporations")
      .find(
        {
          _id: {
            $in: current.flatMap((fund) =>
              fund.sponsorCorporationId ? [fund.sponsorCorporationId] : []
            ),
          },
        },
        { projection: { name: 1, countryId: 1, liquidCurrencyCode: 1 } }
      )
      .toArray();
    const sponsorById = new Map(sponsors.map((sponsor) => [String(sponsor._id), sponsor]));
    const rates = await loadFxRatesRecord(tx);
    const bonds = await sumFundBondHoldingsByFundId(tx, current, rates);
    const escrow = await loadOpenOrdersEscrowByFundId(
      tx,
      current.map((fund) => fund._id)
    );
    const queue = await loadQueuedRedemptionUnitsByFundId(
      tx,
      current.map((fund) => fund._id)
    );
    const fundUpdates = [];
    const sponsorUpdates = [];
    const receipts: IndexFundTransaction[] = [];
    const witnesses = [];
    for (const fund of current) {
      const sponsor = sponsorById.get(String(fund.sponsorCorporationId));
      if (!sponsor) continue;
      const id = String(fund._id);
      const aumAnchor = markedFundBacking({
        cashAnchor: fund.cashAnchor,
        stockValueAnchor: computeHoldingsValueAnchor(fund),
        bondValueAnchor: bonds.get(id) ?? 0,
        orderEscrowAnchor: escrow.get(id) ?? 0,
      });
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
      const currencyCode = resolveCorpLiquidCurrencyCode(sponsor);
      const rate = currencyCode ? rates[currencyCode] : 1;
      if (!rate || !Number.isFinite(rate) || rate <= 0)
        throw new Error("Sponsor exchange rate unavailable");
      const feeLocal = anchorToCorpLiquidCapital(feeAnchor, sponsor, rate);
      const totalClaims = fund.unitSupply + (queue.get(id) ?? 0);
      fundUpdates.push({
        updateOne: {
          filter: { _id: fund._id, cashAnchor: { $gte: feeAnchor } },
          update: {
            $inc: { cashAnchor: -feeAnchor, feesPaidToSponsorAnchor: feeAnchor },
            $set: {
              lastExpenseFeeTurn: currentTurn,
              updatedAt: now,
              ...(totalClaims > 0 ? { quotedNav: (aumAnchor - feeAnchor) / totalClaims } : {}),
            },
          },
        },
      });
      sponsorUpdates.push({
        updateOne: {
          filter: { _id: sponsor._id },
          update: { $inc: { liquidCapital: feeLocal } },
        },
      });
      receipts.push({
        _id: new ObjectId(),
        fundId: fund._id,
        kind: "expense_fee",
        turn: currentTurn,
        corporationId: sponsor._id,
        amountAnchor: -feeAnchor,
        note: `Expense fee to ${sponsor.name}`,
        createdAt: now,
      });
      witnesses.push({
        type: "corp_revenue" as const,
        turn: currentTurn,
        createdAt: now,
        subjectType: "corporation" as const,
        subjectId: sponsor._id,
        subjectName: sponsor.name,
        amount: feeLocal,
        anchorAmount: feeAnchor,
        currencyCode: (currencyCode ?? "USD") as CurrencyCode,
        counterpartyType: "system" as const,
        counterpartyName: fund.name,
        meta: {
          kind: "fund_expense_fee",
          fundId: id,
          fundCurrency: fund.anchorCurrencyCode,
          expenseRatioAnnual: fund.expenseRatioAnnual,
          aumAnchor,
        },
      });
      outcome.fundsCharged += 1;
      outcome.totalFeeAnchor += feeAnchor;
    }
    if (!receipts.length) return outcome;
    const debits = await tx.collection<IndexFund>("indexFunds").bulkWrite(fundUpdates);
    if (debits.matchedCount !== receipts.length) throw new Error("Fund fee debit failed");
    const credits = await tx.collection<Corporation>("corporations").bulkWrite(sponsorUpdates);
    if (credits.matchedCount !== receipts.length) throw new Error("Sponsor fee credit failed");
    await tx.collection<IndexFundTransaction>("indexFundTransactions").insertMany(receipts);
    for (const witness of witnesses) {
      if ((await emitTx(tx, witness)) === "failed") throw new Error("Fund fee witness failed");
    }
    return outcome;
  });
}
