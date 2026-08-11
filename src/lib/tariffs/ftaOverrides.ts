import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { getOrganizationLegislationCollection } from "@/lib/db/collections";

/**
 * Free trade agreement override layer for the tariff system.
 *
 * When two countries are bound by an active FTA (passed in any international
 * organization they both belong to), the per-corp effective tariff between
 * them collapses to zero. This module provides the load + lookup primitives;
 * the actual short-circuit lives in `getEffectiveTariffRate`.
 */

/** Canonical pair key, order-independent. */
export function ftaPairKey(a: CountryId, b: CountryId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export type FtaPairSet = ReadonlySet<string>;

/**
 * Load all currently-active FTA country pairs from organizationLegislation.
 * Each multilateral FTA contributes every C(n,2) pair from its `parties`.
 */
export async function loadActiveFtaPairs(db: Db): Promise<Set<string>> {
  const col = await getOrganizationLegislationCollection(db);
  const active = await col
    .find({ type: "free_trade_agreement", status: "active" }, { projection: { parties: 1 } })
    .toArray();

  const pairs = new Set<string>();
  for (const fta of active) {
    const parties = fta.parties as CountryId[];
    for (let i = 0; i < parties.length; i++) {
      for (let j = i + 1; j < parties.length; j++) {
        pairs.add(ftaPairKey(parties[i], parties[j]));
      }
    }
  }
  return pairs;
}

/**
 * True if the two countries are joined by at least one active FTA.
 *
 * Accepts plain `string` rather than `CountryId` to keep call sites that
 * source country codes from non-CountryId-typed fields (e.g. `SentimentPulse.countryId`,
 * Mongo-stored corp HQ ids) free of casts. The pair set is string-keyed, so
 * an unknown country code is just a miss — no runtime risk.
 */
export function isFtaActive(pairs: FtaPairSet, a: string, b: string): boolean {
  if (a === b) return true; // domestic — treated as fully integrated
  return pairs.has(ftaPairKey(a as CountryId, b as CountryId));
}

/**
 * Per-layer FTA coverage shares used by the macro tariff effects
 * (`getDomesticTariffMalus`, `getTariffBlendWeights`).
 *
 * The two broad scopes (`economy_wide`, `sector`) scale continuously by the
 * FTA-partner share of foreign trade — domestic friction and the
 * commodity-blend tilt drop as FTAs cover more of the country's foreign
 * footprint. The two narrow scopes (`origin_country`, `corporation`) flip
 * binary on `pairs` membership: an FTA-partnered target contributes nothing.
 */
export type FtaCoverage = {
  /** Per sector country: share (0..1) of foreign-corp sector revenue HQ'd in any FTA partner. */
  byCountryEconomyWide: ReadonlyMap<CountryId, number>;
  /** Keyed `${sectorCountry}:${sectorType}`: share (0..1) of foreign-corp revenue
   *  in just that sector type that's HQ'd in an FTA partner. */
  bySectorType: ReadonlyMap<string, number>;
  /** corpId → HQ countryId. Lets `getTariffBlendWeights` resolve a `targetCorporationId`
   *  and run an `isFtaActive` check without re-plumbing corp data. */
  corpHqByCorpId: ReadonlyMap<string, CountryId>;
  /** Reused for `origin_country` / `corporation` scope FTA checks. */
  pairs: FtaPairSet;
};

/**
 * Build an `FtaCoverage` lookup from already-loaded sectors + corp HQ data.
 * Single pass over foreign sectors; domestic sectors are excluded from the
 * denominator (they're not part of foreign-trade exposure). Empty totals
 * yield share `0` (no foreign trade → no FTA effect to apply).
 */
export function buildFtaCoverageLookup(
  sectors: Pick<CorporateSector, "corporationId" | "countryId" | "sectorType" | "revenue">[],
  corpById: Map<string, Pick<Corporation, "_id" | "countryId">>,
  pairs: FtaPairSet
): FtaCoverage {
  const corpHqByCorpId = new Map<string, CountryId>();
  for (const [id, corp] of corpById) {
    corpHqByCorpId.set(id, corp.countryId as CountryId);
  }

  const totalForeignByCountry = new Map<CountryId, number>();
  const partnerForeignByCountry = new Map<CountryId, number>();
  const totalForeignBySectorType = new Map<string, number>();
  const partnerForeignBySectorType = new Map<string, number>();

  for (const sector of sectors) {
    if (!(sector.revenue > 0)) continue;
    const corp = corpById.get(sector.corporationId.toString());
    if (!corp) continue;
    const sectorCountry = sector.countryId as CountryId;
    const corpHq = corp.countryId as CountryId;
    if (sectorCountry === corpHq) continue; // domestic — irrelevant to coverage

    totalForeignByCountry.set(
      sectorCountry,
      (totalForeignByCountry.get(sectorCountry) ?? 0) + sector.revenue
    );
    const sectorKey = `${sectorCountry}:${sector.sectorType}`;
    totalForeignBySectorType.set(
      sectorKey,
      (totalForeignBySectorType.get(sectorKey) ?? 0) + sector.revenue
    );

    if (isFtaActive(pairs, sectorCountry, corpHq)) {
      partnerForeignByCountry.set(
        sectorCountry,
        (partnerForeignByCountry.get(sectorCountry) ?? 0) + sector.revenue
      );
      partnerForeignBySectorType.set(
        sectorKey,
        (partnerForeignBySectorType.get(sectorKey) ?? 0) + sector.revenue
      );
    }
  }

  const byCountryEconomyWide = new Map<CountryId, number>();
  for (const [country, total] of totalForeignByCountry) {
    if (total <= 0) continue;
    const partner = partnerForeignByCountry.get(country) ?? 0;
    byCountryEconomyWide.set(country, partner / total);
  }

  const bySectorType = new Map<string, number>();
  for (const [key, total] of totalForeignBySectorType) {
    if (total <= 0) continue;
    const partner = partnerForeignBySectorType.get(key) ?? 0;
    bySectorType.set(key, partner / total);
  }

  return { byCountryEconomyWide, bySectorType, corpHqByCorpId, pairs };
}
