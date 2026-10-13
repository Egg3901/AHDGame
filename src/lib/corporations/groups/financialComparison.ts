import type { Db, ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types";
import { loadValuationFxRates } from "@/lib/currency/corporationCapital";
import { groupBondDebt } from "./rules/financialComparison";
/** Batch only the bonds of corporations whose private financials the viewer may inspect. */
export async function loadGroupBondDebt(db: Db, ids: readonly ObjectId[]) {
  if (!ids.length) return new Map<string, number | null>();
  const [bonds, rates] = await Promise.all([
    db
      .collection<Bond>("bonds")
      .find(
        { corporationId: { $in: [...ids] }, matured: false },
        { projection: { corporationId: 1, totalIssued: 1, currencyCode: 1, countryId: 1 } }
      )
      .toArray(),
    loadValuationFxRates(db),
  ]);
  return groupBondDebt(
    ids.map((id) => id.toString()),
    bonds.map((b) => ({
      corporationId: b.corporationId!.toString(),
      principal: b.totalIssued,
      currencyCode: b.currencyCode,
      countryId: b.countryId,
    })),
    rates
  );
}
