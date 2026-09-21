/**
 * Year-anchored political-metric baselines.
 *
 * Values resolve by in-game YEAR, never by seed preset — there is no
 * "2019-default" fallback anywhere in this path, and no year is privileged.
 * Interpolation mirrors interpolateBand (src/lib/era/metricCatalog.ts) so the
 * codebase has one interpolation behavior: linear between anchors, clamped at
 * both ends.
 *
 * Each family carries reviewed era anchors. Values between authored years are
 * interpolated; values outside the authored range clamp to the nearest anchor.
 */
import {
  POLITICAL_METRIC_COUNTRY_IDS,
  type PoliticalMetricId,
  type PoliticalMetricsCountryId,
} from "../types";
import { NATIONAL_BASELINES_1953 } from "./nationalBaselines1953";
import { NATIONAL_BASELINES_1979 } from "./nationalBaselines1979";

export interface BaselineAnchor {
  year: number;
  value: number;
}

/** Ascending by year. A single anchor is a valid constant curve. */
export type AnchorTable = Record<
  PoliticalMetricsCountryId,
  Record<PoliticalMetricId, BaselineAnchor[]>
>;

function buildInitialTable(): AnchorTable {
  const out = {} as AnchorTable;
  for (const countryId of POLITICAL_METRIC_COUNTRY_IDS) {
    const perFamily = {} as Record<PoliticalMetricId, BaselineAnchor[]>;
    for (const [metricId, baseline] of Object.entries(NATIONAL_BASELINES_1953[countryId])) {
      const id = metricId as PoliticalMetricId;
      perFamily[id] = [
        { year: 1953, value: baseline.value },
        { year: 1979, value: NATIONAL_BASELINES_1979[countryId][id] },
      ];
    }
    out[countryId] = perFamily;
  }
  return out;
}

export const POLITICAL_BASELINE_ANCHORS: AnchorTable = buildInitialTable();

export function interpolateAnchors(anchors: BaselineAnchor[], year: number): number {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (year <= first.year) return first.value;
  if (year >= last.year) return last.value;
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1];
    const b = anchors[i];
    if (year <= b.year) {
      const t = (year - a.year) / (b.year - a.year);
      return a.value + (b.value - a.value) * t;
    }
  }
  return last.value;
}

/**
 * Resolve one family's baseline for a country at a year. Throws when the family
 * has no anchors — a missing curve is an authoring bug that must surface, never
 * a silent default (that silent-default behavior is what made the old preset
 * fallback so hard to reason about).
 */
export function baselineFor(
  countryId: PoliticalMetricsCountryId,
  metricId: PoliticalMetricId,
  year: number
): number {
  const anchors = POLITICAL_BASELINE_ANCHORS[countryId]?.[metricId];
  if (!anchors || anchors.length === 0) {
    throw new Error(`no baseline anchors for ${countryId} ${metricId}`);
  }
  return interpolateAnchors(anchors, year);
}

/** Structural problems in the shipped table. Empty array means valid. */
export function validateAnchorTable(): string[] {
  const problems: string[] = [];
  for (const countryId of POLITICAL_METRIC_COUNTRY_IDS) {
    const authored = NATIONAL_BASELINES_1953[countryId];
    const perFamily = POLITICAL_BASELINE_ANCHORS[countryId];
    for (const metricId of Object.keys(authored) as PoliticalMetricId[]) {
      const anchors = perFamily?.[metricId];
      if (!anchors || anchors.length === 0) {
        problems.push(`${countryId} ${metricId}: no anchors`);
        continue;
      }
      for (let i = 1; i < anchors.length; i++) {
        if (anchors[i].year <= anchors[i - 1].year) {
          problems.push(`${countryId} ${metricId}: anchors not strictly ascending by year`);
          break;
        }
      }
      for (const a of anchors) {
        if (a.value < 0 || a.value > 100) {
          problems.push(`${countryId} ${metricId}: anchor at ${a.year} out of 0-100 range`);
          break;
        }
      }
    }
  }
  return problems;
}
