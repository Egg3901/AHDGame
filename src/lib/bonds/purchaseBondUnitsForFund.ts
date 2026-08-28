import type { Db, ObjectId } from "mongodb";
import type { Bond, IndexFund } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { corpCapitalToAnchor, loadFxRatesRecord } from "@/lib/currency/corporationCapital";
import { reserveBondUnitsForHolder } from "@/lib/bonds/bondHolderOps";
import { insertFundTransaction } from "@/lib/indexFunds/fundQueries";
import { sovereignBondCapError } from "@/lib/bonds/holderCap";

export type PurchaseBondUnitsForFundResult =
  { ok: true; units: number; costAnchor: number; bondId: ObjectId } | { ok: false; reason: string };

function resolveBondCurrency(bond: Bond): CurrencyCode {
  return (bond.currencyCode ??
    (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
      ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
      : "USD")) as CurrencyCode;
}

async function atomicallyDebitFundCashAnchor(
  db: Db,
  fundId: ObjectId,
  amountAnchor: number
): Promise<{ ok: true; newCashAnchor: number } | { ok: false }> {
  if (!Number.isFinite(amountAnchor) || amountAnchor <= 0) return { ok: false };
  const rounded = Math.round(amountAnchor * 100) / 100;
  const result = await db
    .collection<IndexFund>("indexFunds")
    .findOneAndUpdate(
      { _id: fundId, cashAnchor: { $gte: rounded } },
      { $inc: { cashAnchor: -rounded }, $set: { updatedAt: new Date() } },
      { returnDocument: "after", projection: { cashAnchor: 1 } }
    );
  if (!result) return { ok: false };
  return { ok: true, newCashAnchor: result.cashAnchor };
}

async function refundFundCashAnchor(db: Db, fundId: ObjectId, amountAnchor: number): Promise<void> {
  if (!Number.isFinite(amountAnchor) || amountAnchor <= 0) return;
  const rounded = Math.round(amountAnchor * 100) / 100;
  await db
    .collection("indexFunds")
    .updateOne({ _id: fundId }, { $inc: { cashAnchor: rounded }, $set: { updatedAt: new Date() } });
}

/**
 * Buy bond units from public float on behalf of an index fund.
 * Debits fund `cashAnchor` (anchor currency) and credits `holders.fundId`.
 */
export async function purchaseBondUnitsForFund(
  db: Db,
  fund: Pick<IndexFund, "_id" | "name" | "quotedNav" | "anchorCurrencyCode">,
  bond: Bond,
  units: number
): Promise<PurchaseBondUnitsForFundResult> {
  const wholeUnits = Math.floor(units);
  if (wholeUnits <= 0) return { ok: false, reason: "invalid_units" };
  if (bond.matured || bond.defaulted) return { ok: false, reason: "bond_unavailable" };
  if ((bond.publicFloat ?? 0) < wholeUnits) return { ok: false, reason: "insufficient_float" };
  if (sovereignBondCapError(bond, "fundId", fund._id, wholeUnits)) {
    return { ok: false, reason: "position_limit" };
  }

  const bondCurrency = resolveBondCurrency(bond);
  const fxRates = await loadFxRatesRecord(db);
  const bondFxRate =
    fxRates[bondCurrency] && fxRates[bondCurrency]! > 0 ? fxRates[bondCurrency]! : 1;
  const costLocal = wholeUnits * BOND_UNIT_FACE_VALUE * bond.marketPrice;
  const costAnchor =
    Math.round(corpCapitalToAnchor(costLocal, bondCurrency, bondFxRate) * 100) / 100;
  if (costAnchor <= 0) return { ok: false, reason: "zero_cost" };

  const debit = await atomicallyDebitFundCashAnchor(db, fund._id, costAnchor);
  if (!debit.ok) return { ok: false, reason: "insufficient_fund_cash" };

  const now = new Date();
  const pricePerUnit = BOND_UNIT_FACE_VALUE * bond.marketPrice;
  try {
    const reserved = await reserveBondUnitsForHolder(
      db,
      bond._id,
      { field: "fundId", id: fund._id },
      wholeUnits,
      now,
      { avgCostPerUnit: pricePerUnit }
    );
    if (!reserved) {
      await refundFundCashAnchor(db, fund._id, costAnchor);
      return { ok: false, reason: "reservation_failed" };
    }

    await insertFundTransaction(db, {
      fundId: fund._id,
      kind: "bond_allocation",
      amountAnchor: costAnchor,
      navAnchor: fund.quotedNav,
      note: `Purchased ${wholeUnits} bond units (${bond.issuerName ?? "sovereign"})`,
      createdAt: now,
    });

    return { ok: true, units: wholeUnits, costAnchor, bondId: bond._id };
  } catch (err) {
    await refundFundCashAnchor(db, fund._id, costAnchor);
    throw err;
  }
}
