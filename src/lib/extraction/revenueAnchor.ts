import type { Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  fxRateForSectorHostFromMap,
  loadValuationFxRates,
  resolveSectorHostCurrencyCode,
  type CorpCapitalCurrencyInfo,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";

type RevenueSector = {
  corporationId?: ObjectId | string | null;
  countryId?: string | null;
  revenue: number;
};

/**
 * `sector.revenue` is stored in the sector host's LOCAL currency, but deposit
 * capacity and the era base prices are in ₳ units. Every reader that turns
 * revenue into desired extraction output must convert first, exactly as the
 * world supply ledger does (`buildSectorRows`). Reading it raw made a yen,
 * lira or zloty miner look 100 to 9,500 times larger than its deposit, which
 * capped its production and closed its state to new mines on a currency
 * artifact.
 */
export function extractionRevenueAnchorOf(
  corpById: ReadonlyMap<string, CorpCapitalCurrencyInfo>,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): (sector: RevenueSector) => number {
  return (sector) => {
    const corp = sector.corporationId ? corpById.get(String(sector.corporationId)) : undefined;
    return readCorpEconomicAnchor(
      sector.revenue,
      resolveSectorHostCurrencyCode(sector, corp),
      fxRateForSectorHostFromMap(sector, corp, fxByCurrency)
    );
  };
}

/** Loads the FX map and owning-corp currency fields the converter needs. */
export async function loadExtractionRevenueAnchorOf(
  db: Db,
  sectors: ReadonlyArray<{ corporationId?: ObjectId | string | null }>
): Promise<(sector: RevenueSector) => number> {
  const corpIds = [
    ...new Set(sectors.map((s) => s.corporationId).filter((id) => id != null)),
  ] as ObjectId[];
  const [fxByCurrency, corps] = await Promise.all([
    loadValuationFxRates(db),
    corpIds.length > 0
      ? db
          .collection<CorpCapitalCurrencyInfo & { _id: ObjectId }>("corporations")
          .find({ _id: { $in: corpIds } }, { projection: { countryId: 1, liquidCurrencyCode: 1 } })
          .toArray()
      : Promise.resolve([]),
  ]);
  return extractionRevenueAnchorOf(new Map(corps.map((c) => [String(c._id), c])), fxByCurrency);
}
