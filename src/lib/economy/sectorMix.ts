/**
 * National sector-mix aggregation for the Economic Outlook surfaces.
 *
 * Read-path only: sums the same per-(state, sectorType) effective markets the
 * region economy route computes — owned revenue ₳-normalized per corp FX plus
 * the persisted unowned pool, falling back to the GDP-derived baseline —
 * across every state of a country. No new collections, no writes.
 */

import type { Db } from "mongodb";
import type { CorporateSector, State, UnownedSector } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  CORPORATION_TYPES,
  CORPORATION_TYPE_LABELS,
  type CorporationType,
} from "@/lib/constants/corporations";
import {
  loadFxRatesByCurrency,
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { effectiveMarketAnchor, gdpDerivedMarketAnchor } from "@/lib/corporations/marketShare";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";

export interface CountrySectorMixEntry {
  type: CorporationType;
  label: string;
  /** Σ effective (state, sector) markets across the country, ₳/day. */
  totalMarketAnchor: number;
  /** Corporate-owned share of the national market, 0–100 (1dp). */
  ownedPercent: number;
  /** State with the largest effective market for this sector. */
  largestState: { stateId: string; stateName: string } | null;
  /** Mean target growth across the sector's corps nationwide (%/yr), or null. */
  avgGrowth: number | null;
}

export async function aggregateCountrySectorMix(
  db: Db,
  countryId: CountryId
): Promise<CountrySectorMixEntry[]> {
  const [states, sectors, unownedDocs, fxByCurrency, preset] = await Promise.all([
    db
      .collection<State>("states")
      .find({ countryId })
      .project<Pick<State, "_id" | "name" | "gdp">>({ name: 1, gdp: 1 })
      .toArray(),
    db.collection<CorporateSector>("corporateSectors").find({ countryId }).toArray(),
    db.collection<UnownedSector>("unownedSectors").find({ countryId }).toArray(),
    loadFxRatesByCurrency(db),
    loadWorldPreset(db),
  ]);

  // Every sector here is physically in `countryId`, so they all share one
  // host-state functional currency (the currency their revenue is stored in,
  // regardless of which corp owns them). Resolve the ₳ conversion rate once
  // from the host country rather than per owning corp.
  const hostCode = resolveSectorHostCurrencyCode({ countryId }, null);
  const hostRate = fxRateForSectorHostFromMap({ countryId }, null, fxByCurrency);

  // Owned revenue per (state, sectorType) bucket, ₳-normalized; and the
  // running sum/count of current (realized) growth per sector type for the
  // national mean.
  const bucketKey = (stateId: string, type: CorporationType) => `${stateId}::${type}`;
  const ownedByBucket = new Map<string, number>();
  const growthSumByType = new Map<CorporationType, number>();
  const growthCountByType = new Map<CorporationType, number>();
  for (const s of sectors) {
    const anchor = readCorpEconomicAnchor(s.revenue, hostCode, hostRate);
    const type = s.sectorType as CorporationType;
    ownedByBucket.set(
      bucketKey(s.stateId, type),
      (ownedByBucket.get(bucketKey(s.stateId, type)) ?? 0) + anchor
    );
    const growth = s.currentGrowthRate ?? s.targetGrowthRate ?? s.growthRate ?? 0;
    growthSumByType.set(type, (growthSumByType.get(type) ?? 0) + growth);
    growthCountByType.set(type, (growthCountByType.get(type) ?? 0) + 1);
  }
  const unownedByBucket = new Map<string, number>();
  for (const u of unownedDocs) {
    unownedByBucket.set(bucketKey(u.stateId, u.sectorType), u.revenue);
  }

  return CORPORATION_TYPES.map((type) => {
    let totalMarket = 0;
    let totalOwned = 0;
    let largest: { stateId: string; stateName: string; market: number } | null = null;
    for (const state of states) {
      const key = bucketKey(state._id, type);
      const owned = ownedByBucket.get(key) ?? 0;
      const market = effectiveMarketAnchor(
        owned,
        unownedByBucket.get(key),
        gdpDerivedMarketAnchor(state.gdp ?? 0, countryId, preset)
      );
      totalMarket += market;
      totalOwned += owned;
      if (market > 0 && (largest == null || market > largest.market)) {
        largest = { stateId: state._id, stateName: state.name, market };
      }
    }
    const gCount = growthCountByType.get(type) ?? 0;
    return {
      type,
      label: CORPORATION_TYPE_LABELS[type],
      totalMarketAnchor: Math.round(totalMarket),
      ownedPercent: totalMarket > 0 ? Math.round((totalOwned / totalMarket) * 1000) / 10 : 0,
      largestState: largest ? { stateId: largest.stateId, stateName: largest.stateName } : null,
      avgGrowth:
        gCount > 0 ? Math.round(((growthSumByType.get(type) ?? 0) / gCount) * 100) / 100 : null,
    };
  });
}
