import {
  FAMILY_SLUGS,
  POLITICAL_METRIC_CATEGORIES,
  type PoliticalMetricCategoryId,
  type PoliticalMetricId,
  type PoliticalMetricsCountryId,
} from "../types";

type CategoryRows = Record<PoliticalMetricCategoryId, readonly number[]>;

function buildBaselines(rows: CategoryRows): Record<PoliticalMetricId, number> {
  const out = {} as Record<PoliticalMetricId, number>;
  for (const category of POLITICAL_METRIC_CATEGORIES) {
    const values = rows[category.id];
    if (values.length !== 7)
      throw new Error(`1979 baseline rows for ${category.id} must have 7 entries`);
    FAMILY_SLUGS[category.id].forEach((slug, index) => {
      out[`${category.id}.${slug}` as PoliticalMetricId] = values[index];
    });
  }
  return out;
}

/**
 * National 1979 political-metric anchors for the four playable countries.
 *
 * Domestic categories are national means derived from the committed 1979
 * regional metric sources through the same legacy inversion used for
 * non-playable political boards. Defense is national by definition and is
 * authored directly for each country's late-Cold-War posture.
 */
export const NATIONAL_BASELINES_1979: Record<
  PoliticalMetricsCountryId,
  Record<PoliticalMetricId, number>
> = {
  US: buildBaselines({
    economy: [55, 60.7, 41.7, 76.6, 49.5, 67, 34.6],
    education: [36.6, 44.5, 30.7, 60.3, 44.5, 35.3, 44.5],
    health: [53.1, 54.3, 47.2, 51.3, 53.1, 53.1, 66.7],
    infrastructure: [79.4, 32.4, 86.1, 82.1, 39.3, 61.3, 47.9],
    order: [49.3, 49.3, 34.3, 57.4, 49.3, 38.5, 49.3],
    environment: [93.5, 91.4, 94.6, 65, 75.6, 75.6, 75.6],
    society: [47.6, 71.3, 62.1, 60.8, 41, 89.5, 66.8],
    governance: [25.9, 57.9, 23.2, 36.1, 51.2, 51.2, 51.2],
    defense: [70, 72, 85, 68, 75, 78, 82],
  }),
  UK: buildBaselines({
    economy: [53.6, 47.1, 70.9, 75.8, 51.1, 65.9, 56],
    education: [52.6, 39.4, 41.3, 20.7, 39.4, 54.2, 39.4],
    health: [85.5, 40, 75, 84.2, 61.2, 61.2, 19.6],
    infrastructure: [82.2, 61.3, 99.5, 74.4, 59.3, 73.9, 49.6],
    order: [56.7, 56.7, 65.3, 61, 56.7, 40.6, 56.7],
    environment: [94.7, 100, 82.6, 58, 78.5, 78.5, 78.5],
    society: [56.1, 40, 48.2, 45.7, 41.3, 79.4, 59.4],
    governance: [51.6, 52.9, 58.2, 50.7, 58.2, 58.2, 58.2],
    defense: [78, 75, 75, 60, 65, 62, 65],
  }),
  RU: buildBaselines({
    economy: [63.2, 79.2, 0.1, 83.9, 70.8, 83.3, 11.1],
    education: [52.1, 65.5, 70, 85.2, 65.5, 40, 65.5],
    health: [83.3, 51.5, 58.3, 63.8, 63.3, 63.3, 66.7],
    infrastructure: [86.9, 86.7, 65.4, 52.6, 80, 62.5, 37.5],
    order: [64.8, 64.8, 54.5, 95.9, 64.8, 75, 64.8],
    environment: [63.6, 93.9, 100, 65, 71.5, 71.5, 71.5],
    society: [54.5, 65, 69.2, 56.5, 69.6, 97.2, 75.3],
    governance: [55, 23, 50, 35.2, 42.8, 42.8, 42.8],
    defense: [55, 50, 60, 85, 88, 90, 88],
  }),
  DD: buildBaselines({
    economy: [58.6, 73.6, 35.1, 84.2, 73.3, 72.2, 11.5],
    education: [62.5, 70.8, 86.7, 82.9, 70.8, 40, 70.8],
    health: [85, 53.6, 64.2, 54.7, 63.4, 63.4, 66.7],
    infrastructure: [87.8, 78.7, 48.8, 54.4, 74, 55.3, 42.9],
    order: [76, 76, 36.4, 95.1, 76, 100, 76],
    environment: [36.4, 72.9, 55.9, 65, 62.2, 62.2, 62.2],
    society: [40, 65, 79.2, 36.8, 47.8, 95.3, 76.5],
    governance: [55, 11.2, 33.3, 38.3, 36.7, 36.7, 36.7],
    defense: [40, 30, 30, 80, 72, 70, 45],
  }),
};
