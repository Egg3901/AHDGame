import type { Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Total savings balances held in a given currency across all characters (forex buckets + legacy savingsOnHand for matching home country).
 */
export async function sumSavingsInCurrency(db: Db, currencyCode: CurrencyCode): Promise<number> {
  const sumPath = `$currencyBalances.savings.${currencyCode}`;
  const matchField = `currencyBalances.savings.${currencyCode}`;
  const bucket = await db
    .collection("characters")
    .aggregate<{ total: number }>([
      { $match: { [matchField]: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: sumPath } } },
    ])
    .toArray();
  let total = bucket[0]?.total ?? 0;

  const countryId: CountryId = getCountryIdForCurrency(currencyCode);
  const legacy = await db
    .collection("characters")
    .aggregate<{ s: number }>([
      {
        $match: {
          countryId,
          savingsOnHand: { $gt: 0 },
          currencyBalances: { $exists: false },
        },
      },
      { $group: { _id: null, s: { $sum: "$savingsOnHand" } } },
    ])
    .toArray();
  total += legacy[0]?.s ?? 0;

  return Math.round(total * 100) / 100;
}
