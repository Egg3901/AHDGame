/**
 * Wind-up distributions pay corporate investors in their own cash currency.
 * Holder currencies are read together and payouts and witnesses are batched.
 */
import { ObjectId, type Db } from "mongodb";
import type {
  Corporation,
  IndexFund,
  IndexFundPosition,
  IndexFundTransaction,
} from "@/lib/db/types";
import {
  anchorToCorpLiquidCapital,
  loadFxRatesRecord,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { isForexEnabled } from "@/lib/currency/featureFlag";

export async function payCorporateWindUpHolders(
  db: Db,
  fund: IndexFund,
  positions: IndexFundPosition[],
  finalNav: number,
  turn: number,
  now: Date
) {
  const corporatePositions = positions.filter(
    (p) => p.holderKind === "corporation" && p.corporationId && p.units > 0
  );
  if (!corporatePositions.length) return { holdersPaid: 0, distributedAnchor: 0 };
  const corporations = await db
    .collection<Corporation>("corporations")
    .find(
      { _id: { $in: corporatePositions.map((p) => p.corporationId!) } },
      { projection: { liquidCurrencyCode: 1, countryId: 1 } }
    )
    .toArray();
  const byId = new Map(corporations.map((c) => [c._id.toString(), c]));
  const forex = await isForexEnabled();
  const rates = forex ? await loadFxRatesRecord(db) : {};
  const operations: Array<{
    updateOne: {
      filter: { _id: ObjectId };
      update: { $inc: { liquidCapital: number }; $set: { updatedAt: Date } };
    };
  }> = [];
  const transactions: IndexFundTransaction[] = [];
  let distributedAnchor = 0;
  for (const position of corporatePositions) {
    const corp = byId.get(position.corporationId!.toString());
    const amountAnchor = Math.floor(position.units * finalNav);
    if (!corp || amountAnchor <= 0) continue;
    const currency = resolveCorpLiquidCurrencyCode(corp);
    const rate = forex && currency ? rates[currency] : 1;
    if (!rate || rate <= 0) throw new Error("Corporate payout exchange rate unavailable");
    operations.push({
      updateOne: {
        filter: { _id: corp._id },
        update: {
          $inc: { liquidCapital: anchorToCorpLiquidCapital(amountAnchor, corp, rate) },
          $set: { updatedAt: now },
        },
      },
    });
    transactions.push({
      _id: new ObjectId(),
      fundId: fund._id,
      corporationId: corp._id,
      holderKind: "corporation",
      kind: "wind_up_distribution",
      turn,
      units: position.units,
      amountAnchor,
      note: `Wind-up distribution from ${fund.name}`,
      createdAt: now,
    });
    distributedAnchor += amountAnchor;
  }
  if (operations.length) {
    await db.collection("corporations").bulkWrite(operations);
    await db.collection<IndexFundTransaction>("indexFundTransactions").insertMany(transactions);
  }
  return { holdersPaid: operations.length, distributedAnchor };
}
