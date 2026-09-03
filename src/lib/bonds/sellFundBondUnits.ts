/**
 * Sell an index fund's bond holdings to the market pool for cash.
 *
 * Used when a fund owes redemptions it cannot pay from cash. Each holding is
 * sold at the pool's bid, largest position first, only as far as the pool can
 * pay (gated debit). Units go back to the pool (`publicFloat`), cash lands on
 * the fund in anchor terms. Nothing is minted: a pool with no cash buys
 * nothing and the redemption waits.
 */

import type { Db } from "mongodb";
import type { Bond, IndexFund } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { corpCapitalToAnchor, loadFxRatesRecord } from "@/lib/currency/corporationCapital";
import {
  bondPoolCurrency,
  debitBondPoolGated,
  loadBondQuote,
  refundBondPoolDebit,
} from "@/lib/bonds/marketPool";
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
  now: Date = new Date()
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
    await db
      .collection<Bond>("bonds")
      .updateOne(
        { _id: bond._id },
        { $pull: { holders: { fundId: fund._id, units: { $lte: 0 } } } }
      );

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

    remainingAnchor -= proceedsAnchor;
    result.proceedsAnchor += proceedsAnchor;
    result.unitsSold += units;
    result.bondsTouched++;
  }
  return result;
}
