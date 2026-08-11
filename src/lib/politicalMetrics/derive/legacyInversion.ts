/**
 * Legacy stateMetrics value → 0-100 political family score.
 *
 * The inverse of the Bridge A band adapter, and the primitive the non-playable
 * board derivation is built on. Delegates the hard part — per-metric realistic
 * ranges and polarity (crimeRate is lower-better, literacyRate higher-better) —
 * to normalizedMetricQuality, which the corp margin path already relies on. A
 * sign error here would invert a country's entire board silently, so polarity
 * is NOT re-implemented locally.
 *
 * Pure and safe to call at runtime — Bridge B's macro residual does exactly
 * that, converting a live macroMetrics value into a comparable board score.
 *
 * What must NEVER happen is the reverse: `deriveCountryBoard` producing a board
 * at runtime as a fallback for a missing seed. Derivation output is committed
 * and reviewed (see nonPlayableBoards.ts); a live-derived board would ship
 * unreviewed values into game state. This function is a conversion primitive,
 * not that pipeline.
 */
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import {
  metricQualityRange,
  normalizedMetricQuality,
} from "@/lib/corporations/sectorMetricMarginProfiles";
import type { MetricCategoryId } from "@/lib/db/types";

/** quality(-1..1) → score(0..100), with 0 quality landing on the neutral 50. */
const qualityToScore = (q: number) => Math.max(0, Math.min(100, 50 + q * 50));

export function politicalScoreFromLegacyValue(
  category: string,
  metricId: string,
  value: number,
  countryId?: string | null,
  year?: number | null
): number | null {
  if (!Number.isFinite(value)) return null;
  const definition = getMetricDefinition(category as MetricCategoryId, metricId);
  if (!definition) return null;
  const quality = normalizedMetricQuality(value, definition, metricId, countryId ?? null, year);
  if (!Number.isFinite(quality)) return null;
  return qualityToScore(quality);
}

/**
 * The exact inverse: a 0-100 board score back to the legacy metric's own unit.
 *
 * This is what a consumer that still thinks in legacy units needs once its
 * country reads the board — energy nudges toward a grid-reliability target,
 * tick-rate displays, SOE inputs. It normalizes over `metricQualityRange`, the
 * SAME span the forward direction uses, so `score → value → score` round-trips
 * to within floating-point noise for any value inside the realistic range.
 *
 * NOT interchangeable with Bridge A's `legacyUnitFromPoliticalScore`. That one
 * maps a score onto a band whose mid is DERIVED FROM A CONSUMER'S OWN NEUTRAL,
 * so score 50 reproduces that engine's existing behaviour exactly — a parity
 * property. This one is the mathematical inverse of the derivation, so score 50
 * lands on the midpoint of the metric's realistic range. Use Bridge A where an
 * engine has a neutral to preserve; use this where the consumer is simply
 * asking "what value does this region's board correspond to?".
 *
 * Returns null for `medianIncome`, whose forward direction is a log scale over
 * USD-converted values — inverting it would need the country's exchange rate
 * and it is a macro metric no political consumer reads.
 */
export function legacyValueFromPoliticalScore(
  category: string,
  metricId: string,
  score: number,
  era?: { countryId?: string | null; year?: number | null }
): number | null {
  if (!Number.isFinite(score)) return null;
  if (metricId === "medianIncome") return null;
  const definition = getMetricDefinition(category as MetricCategoryId, metricId);
  if (!definition) return null;
  const { min, max } = metricQualityRange(definition, metricId, era);
  if (!(max > min)) return null;

  const quality = Math.max(-1, Math.min(1, (score - 50) / 50));
  // Undo the isHigherBetter flip, then the [0,1] normalization.
  const normalized = definition.isHigherBetter ? (quality + 1) / 2 : 1 - (quality + 1) / 2;
  return min + normalized * (max - min);
}
