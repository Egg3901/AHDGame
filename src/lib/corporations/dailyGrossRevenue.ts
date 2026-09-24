import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { sectorEconomicScale } from "@/lib/corporations/sectorProfitBasis";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import {
  anchorToCorpLiquidCapital,
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  fxRateForSectorHostFromMap,
  loadFxRatesByCurrency,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";

/**
 * A corporation's daily gross revenue, expressed in the corp's OWN currency.
 *
 * Ticket #1118. This used to be a bare sum of every sector's `revenue`, which
 * silently added currencies together. Sector revenue is stored in the sector's
 * host currency, so a corp with one Japanese sector was summing hundreds of
 * millions of yen straight into a dollar total. The reporter had a Kansai
 * retail sector booking 268,000,000 JPY, worth well under a million dollars at
 * 1953 rates, next to fifteen million dollars of US sectors. The sum came out
 * around 283,000,000, roughly eighteen times the real figure, and every cost
 * priced off it inherited the error.
 *
 * Each sector is therefore converted to the anchor at its own host rate before
 * being added, and only the total is converted into the corp's currency.
 *
 * The `sectorEconomicScale` basis is preserved exactly: under plants that is
 * `max(revenue, capacity value)` rather than raw revenue, and callers depended
 * on that. The only thing that changes is that the amounts being added are
 * finally in the same unit.
 */
export interface CorpDailyGrossRevenuePricing {
  dailyGrossRevenueLocal: number;
  capacityFloorApplied: boolean;
}

/**
 * Pure counterpart to {@link corpDailyGrossRevenuePricingLocal} for turn paths
 * that already hold the sector, feature, era, and FX snapshots. Keeping this
 * arithmetic shared prevents autonomous NPP unlocks from pricing raw host
 * currencies together or treating the already-daily sector revenue as hourly.
 */
export function corpDailyGrossRevenueLocalFromSectors(
  sectors: readonly CorporateSector[],
  corp: Pick<Corporation, "countryId" | "liquidCurrencyCode">,
  options: {
    plantsEnabled: boolean;
    eraUnitScale: number;
    fxByCurrency: ReadonlyMap<CurrencyCode, number>;
  }
): number {
  let totalAnchor = 0;
  for (const sector of sectors) {
    const local = sectorEconomicScale(sector, options.plantsEnabled, options.eraUnitScale);
    if (!local) continue;
    totalAnchor += corpCapitalToAnchor(
      local,
      resolveSectorHostCurrencyCode(sector, corp),
      fxRateForSectorHostFromMap(sector, corp, options.fxByCurrency)
    );
  }

  return anchorToCorpLiquidCapital(
    totalAnchor,
    corp,
    fxRateForCorpFromMap(corp, options.fxByCurrency)
  );
}

/** The pricing basis plus whether owned plant capacity supplied its floor. */
export async function corpDailyGrossRevenuePricingLocal(
  db: Db,
  corp: Pick<Corporation, "_id" | "countryId" | "liquidCurrencyCode">
): Promise<CorpDailyGrossRevenuePricing> {
  const [sectors, plantsEnabled, eraUnitScale, fxByCurrency] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { corporationId: corp._id },
        {
          projection: {
            revenue: 1,
            capitalStock: 1,
            strategyId: 1,
            sectorType: 1,
            countryId: 1,
          },
        }
      )
      .toArray(),
    getMarketSystemModeForDb(db).then((m) => marketAtLeast(m, "plants")),
    loadWorldEraUnitScale(db),
    loadFxRatesByCurrency(db),
  ]);

  return {
    dailyGrossRevenueLocal: corpDailyGrossRevenueLocalFromSectors(sectors, corp, {
      plantsEnabled,
      eraUnitScale,
      fxByCurrency,
    }),
    capacityFloorApplied: plantsEnabled,
  };
}

export async function corpDailyGrossRevenueLocal(
  db: Db,
  corp: Pick<Corporation, "_id" | "countryId" | "liquidCurrencyCode">
): Promise<number> {
  return (await corpDailyGrossRevenuePricingLocal(db, corp)).dailyGrossRevenueLocal;
}
