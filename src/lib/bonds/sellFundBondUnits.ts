/**
 * Sell an index fund's bond holdings to the market pool for cash.
 *
 * Used when a fund owes redemptions it cannot pay from cash. Each holding is
 * sold at the pool's bid, largest position first, only as far as the pool can
 * pay (gated debit). Units go back to the pool (`publicFloat`), cash lands on
 * the fund in anchor terms. Nothing is minted: a pool with no cash buys
 * nothing and the redemption waits.
 */

import type { Db, UpdateFilter } from "mongodb";
import type { Bond, IndexFund } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { corpCapitalToAnchor, loadFxRatesRecord } from "@/lib/currency/corporationCapital";
import {
  bondPoolCurrency,
  debitBondPoolGated,
  loadBondQuote,
  refundBondPoolDebit,
} from "@/lib/bonds/marketPool";
import { emitTx, loadTxThresholds } from "@/lib/financialTxLog/emit";
import type { TxThresholds } from "@/lib/db/types/financialTxLog";
import { insertFundTransaction } from "@/lib/indexFunds/fundQueries";

export interface SellFundBondsResult {
  proceedsAnchor: number;
  unitsSold: number;
  bondsTouched: number;
}

function fxFor(rates: Record<string, number>, currency: CurrencyCode): number {
  const rate = rates[currency];
  return Number.isFinite(rate) && rate! > 0 ? rate! : 1;
}

export async function sellFundBondHoldingsForCash(
  db: Db,
  fund: Pick<IndexFund, "_id" | "name" | "quotedNav" | "anchorCurrencyCode">,
  neededAnchor: number,
  now: Date = new Date(),
  options?: {
    /**
     * #992 tranche 6: game turn stamped on each fund-subject ledger row.
     * When absent the sales still settle but emit no rows.
     */
    turn?: number;
    /** Preloaded thresholds shared by every sale row in the pass. */
    thresholds?: TxThresholds;
  }
): Promise<SellFundBondsResult> {
  const result: SellFundBondsResult = { proceedsAnchor: 0, unitsSold: 0, bondsTouched: 0 };
  if (!(neededAnchor > 0)) return result;

  const bonds = await db
    .collection<Bond>("bonds")
    .find({
      matured: false,
      defaulted: { $ne: true },
      holders: { $elemMatch: { fundId: fund._id } },
    })
    .toArray();
  if (bonds.length === 0) return result;

  const fxRates = await loadFxRatesRecord(db);
  const positions = bonds
    .map((bond) => ({
      bond,
      units: bond.holders.find((h) => h.fundId?.toString() === fund._id.toString())?.units ?? 0,
    }))
    .filter((row) => row.units > 0)
    .sort((a, b) => b.units * b.bond.marketPrice - a.units * a.bond.marketPrice);

  // One thresholds read for the whole sale pass; every row below shares it.
  const thresholds =
    options?.turn !== undefined ? (options?.thresholds ?? (await loadTxThresholds(db))) : undefined;

  let remainingAnchor = neededAnchor;
  for (const { bond, units: held } of positions) {
    if (remainingAnchor <= 0) break;
    const currency = bondPoolCurrency(bond);
    const rate = fxFor(fxRates, currency);
    const quote = await loadBondQuote(db, bond);
    if (!(quote.bidPerUnit > 0)) continue;
    const neededLocal = remainingAnchor * rate;
    const wantUnits = Math.min(held, Math.ceil(neededLocal / quote.bidPerUnit));
    const units = Math.min(wantUnits, quote.depthUnitsAtBid);
    if (units <= 0) continue;
    const proceedsLocal = Math.round(units * quote.bidPerUnit * 100) / 100;

    const debit = await debitBondPoolGated(db, currency, proceedsLocal, "salesOut", now);
    if (!debit.ok) continue;
    const release = await db
      .collection<Bond>("bonds")
      .updateOne(
        { _id: bond._id, holders: { $elemMatch: { fundId: fund._id, units: { $gte: units } } } },
        { $inc: { "holders.$.units": -units, publicFloat: units }, $set: { updatedAt: now } }
      );
    if (release.modifiedCount === 0) {
      await refundBondPoolDebit(db, currency, proceedsLocal, "salesOut", now);
      continue;
    }
    await db.collection<Bond>("bonds").updateOne({ _id: bond._id }, {
      $pull: { holders: { fundId: fund._id, units: { $lte: 0 } } },
    } as unknown as UpdateFilter<Bond>);

    const proceedsAnchor =
      Math.round(corpCapitalToAnchor(proceedsLocal, currency, rate) * 100) / 100;
    await db
      .collection("indexFunds")
      .updateOne(
        { _id: fund._id },
        { $inc: { cashAnchor: proceedsAnchor }, $set: { updatedAt: now } }
      );
    await insertFundTransaction(db, {
      fundId: fund._id,
      kind: "bond_sale",
      amountAnchor: proceedsAnchor,
      navAnchor: fund.quotedNav,
      note: `Sold ${units} bond units (${bond.issuerName ?? "bond"}) to the market for liquidity`,
      createdAt: now,
    });

    // #992 tranche 6: fund-subject ledger leg for the cashAnchor credit
    // above. The bond position is an asset account the shadow ledger does
    // not carry, so the row is single-sided under the shared
    // bond_principal_investment reason (the purchase leg shares it, netting
    // per currency). Fund-subject rows never mirror, so this is the only
    // ledger row for the credit, and it fires only on the committed path
    // — a refunded pool debit or a lost holder race emits nothing.
    if (options?.turn !== undefined) {
      await emitTx(
        db,
        {
          type: "bond_sell",
          turn: options.turn,
          createdAt: now,
          subjectType: "fund",
          subjectId: fund._id,
          subjectName: fund.name,
          amount: proceedsAnchor,
          anchorAmount: proceedsAnchor,
          currencyCode: fund.anchorCurrencyCode,
          counterpartyType: "system",
          counterpartyName: bond.issuerName ?? "Bond market",
          meta: {
            bondId: bond._id.toString(),
            units,
            pricePerUnit: quote.bidPerUnit,
            source: "redemption-liquidity",
          },
        },
        thresholds
      );
    }

    remainingAnchor -= proceedsAnchor;
    result.proceedsAnchor += proceedsAnchor;
    result.unitsSold += units;
    result.bondsTouched++;
  }
  return result;
}
