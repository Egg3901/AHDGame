import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";

const HISTORY_CAP = 96;

interface CorporationCountrySnapshot {
  _id: string;
  countryId: string;
  turn: number;
  corpCount: number;
  totalMarketCapAnchor: number;
  totalLiquidCapitalAnchor: number;
  createdAt: Date;
}

/**
 * Snapshot corporation count + aggregate market cap/liquid capital by country
 * once per turn — the "corporations by country over time" timeline for the
 * sim experiments report. No existing per-turn historical trail for this
 * (stockExchangeSnapshot.ts only covers public listings, not country
 * aggregates — confirmed before writing this).
 *
 * Corp financials (sharePrice, liquidCapital) are local-currency — converted
 * to anchor via the SAME loadFxRatesByCurrency + resolveCorpLiquidCurrencyCode
 * + readCorpEconomicAnchor pattern marketCapSnapshot.ts already uses, so this
 * doesn't repeat the currency-conversion bug this session already found and
 * fixed once for NPP wealth (src/lib/sim/metrics.ts).
 */
export async function snapshotCorporationsByCountry(db: Db, turn: number): Promise<number> {
  const corporations = await db
    .collection<Corporation>("corporations")
    .find(
      {},
      {
        projection: {
          countryId: 1,
          sharePrice: 1,
          totalShares: 1,
          liquidCapital: 1,
          liquidCurrencyCode: 1,
        },
      }
    )
    .toArray();
  if (corporations.length === 0) return 0;

  const fxByCurrency = await loadFxRatesByCurrency(db);

  const byCountry = new Map<
    string,
    { corpCount: number; marketCapAnchor: number; liquidCapitalAnchor: number }
  >();
  for (const corp of corporations) {
    const countryId = (corp.countryId as string) ?? "US";
    const code = resolveCorpLiquidCurrencyCode(corp);
    const rate = fxRateForCorpFromMap(corp, fxByCurrency);

    const sharePriceAnchor = readCorpEconomicAnchor(corp.sharePrice ?? 0.1, code, rate);
    const marketCapAnchor = sharePriceAnchor * (corp.totalShares ?? 10_000_000);
    const liquidCapitalAnchor = readCorpEconomicAnchor(corp.liquidCapital ?? 0, code, rate);

    const entry = byCountry.get(countryId) ?? {
      corpCount: 0,
      marketCapAnchor: 0,
      liquidCapitalAnchor: 0,
    };
    entry.corpCount += 1;
    entry.marketCapAnchor += marketCapAnchor;
    entry.liquidCapitalAnchor += liquidCapitalAnchor;
    byCountry.set(countryId, entry);
  }

  const now = new Date();
  const ops = [...byCountry.entries()].map(([countryId, agg]) => {
    const id = `${countryId}:${turn}`;
    return {
      updateOne: {
        filter: { _id: id },
        update: {
          $set: {
            _id: id,
            countryId,
            turn,
            corpCount: agg.corpCount,
            totalMarketCapAnchor: Math.round(agg.marketCapAnchor),
            totalLiquidCapitalAnchor: Math.round(agg.liquidCapitalAnchor),
            createdAt: now,
          },
        },
        upsert: true,
      },
    };
  });

  await db
    .collection<CorporationCountrySnapshot>("corporationCountryHistory")
    .bulkWrite(ops, { ordered: false });

  const minTurn = Math.max(1, turn - HISTORY_CAP + 1);
  await db.collection("corporationCountryHistory").deleteMany({ turn: { $lt: minTurn } });

  return ops.length;
}
