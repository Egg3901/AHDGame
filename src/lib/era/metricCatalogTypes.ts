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
