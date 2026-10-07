import type { CountryId } from "@/lib/constants/countries";

export interface BandAnchor {
  year: number;
  best: number;
  worst: number;
}

export interface MetricBandCurve {
  /** Fallback anchors when a country has none. Optional — static THRESHOLDS is the final fallback. */
  global?: BandAnchor[];
  /** Per-country anchors; first-class, not an outlier patch. */
  byCountry?: Partial<Record<CountryId, BandAnchor[]>>;
}

export type NormalAnchor = { year: number; value: number };

/**
 * Income anchor for a world that STARTS in a given year, plus the provenance id
 * its seeded incomes are stamped with. Scoring uses `value` only when the
 * world's stamp for the country equals `id`; bump `id` when the seed values
 * change so an older stamp falls back to the legacy anchor.
 */
export type IncomeStartVintage = { value: number; id: string };

/**
 * Per-country income vintage provenance (`gameState.incomeStartVintages`):
 * the vintage id the world's median incomes were seeded or migrated with.
 * Missing means legacy data.
 */
export type IncomeVintageStamps = Partial<Record<string, string>>;
