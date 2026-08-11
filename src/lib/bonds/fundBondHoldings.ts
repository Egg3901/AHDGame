import type { Db, ObjectId } from "mongodb";
import type { Bond, IndexFund } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { corpCapitalToAnchor } from "@/lib/currency/corporationCapital";

export type FundBondHoldingRow = {
  bondId: ObjectId;
  countryId?: Bond["countryId"];
  units: number;
  couponRate: number;
  marketPrice: number;
  currencyCode: CurrencyCode;
  valueAnchor: number;
};

function resolveBondCurrency(bond: Bond): CurrencyCode {
  return (bond.currencyCode ??
    (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
      ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
      : "USD")) as CurrencyCode;
}

/** List bond positions held by an index fund across all bond series. */
export async function listFundBondHoldings(
  db: Db,
  fundId: ObjectId
): Promise<FundBondHoldingRow[]> {
  const bonds = await db
    .collection<Bond>("bonds")
    .find({
      matured: false,
      defaulted: { $ne: true },
      holders: { $elemMatch: { fundId } },
    })
    .toArray();

  const rows: FundBondHoldingRow[] = [];
  for (const bond of bonds) {
    const holder = bond.holders.find((h) => h.fundId?.toString() === fundId.toString());
    if (!holder || holder.units <= 0) continue;
    const currencyCode = resolveBondCurrency(bond);
    const valueLocal = holder.units * BOND_UNIT_FACE_VALUE * bond.marketPrice;
    rows.push({
      bondId: bond._id,
      countryId: bond.countryId,
      units: holder.units,
      couponRate: bond.couponRate,
      marketPrice: bond.marketPrice,
      currencyCode,
      valueAnchor: valueLocal,
    });
  }
  return rows;
}

/** Mark-to-market bond holdings for a fund, converted to the fund anchor currency. */
export async function sumFundBondHoldingsValueAnchor(
  db: Db,
  fund: Pick<IndexFund, "_id" | "anchorCurrencyCode">,
  exchangeRates: Partial<Record<string, number>>
): Promise<number> {
  const holdings = await listFundBondHoldings(db, fund._id);
  if (holdings.length === 0) return 0;

  // Fail loud rather than valuing real bond holdings at zero: a silent 0
  // erases the reserve bucket from NAV and reads as a backing collapse.
  const anchorRate = exchangeRates[fund.anchorCurrencyCode];
  if (!anchorRate || anchorRate <= 0) {
    throw new Error(
      `Missing exchange rate for fund anchor currency ${fund.anchorCurrencyCode}; cannot value bond holdings`
    );
  }

  let total = 0;
  for (const row of holdings) {
    const localRate = exchangeRates[row.currencyCode];
    if (!localRate || localRate <= 0) {
      throw new Error(
        `Missing exchange rate for bond currency ${row.currencyCode}; cannot value bond holdings`
      );
    }
    total += corpCapitalToAnchor(row.valueAnchor, row.currencyCode, localRate);
  }
  return Number.isFinite(total) ? Math.max(0, total) : 0;
}
