import {
  FAMILY_SLUGS,
  POLITICAL_METRIC_CATEGORIES,
  type PoliticalMetricCategoryId,
  type PoliticalMetricId,
  type PoliticalMetricsCountryId,
} from "../types";

export interface PoliticalMetricBaseline {
  value: number;
  /** Authored trajectory retained as calibration input for the dynamics sub-project; NOT surfaced in v1. */
  trendPerYear: number;
}

type CategoryRows = Record<PoliticalMetricCategoryId, ReadonlyArray<readonly [number, number]>>;

function buildBaselines(rows: CategoryRows): Record<PoliticalMetricId, PoliticalMetricBaseline> {
  const out = {} as Record<PoliticalMetricId, PoliticalMetricBaseline>;
  for (const cat of POLITICAL_METRIC_CATEGORIES) {
    const pairs = rows[cat.id];
    if (pairs.length !== 7) throw new Error(`Baseline rows for ${cat.id} must have 7 entries`);
    FAMILY_SLUGS[cat.id].forEach((slug, i) => {
      const [value, trendPerYear] = pairs[i];
      out[`${cat.id}.${slug}` as PoliticalMetricId] = { value, trendPerYear };
    });
  }
  return out;
}

// Authored campaign-start world state (values adopted from the approved design
// catalog, docs/superpowers/specs/assets/2026-07-16-metrics-mock-data.js VALUES):
// US = postwar consolidation and armistice dividend; UK = austerity exit, strong
// institutions, strained finances; RU = succession crisis — weak governance and
// openness, strong heavy industry and state control. Seven [value, trendPerYear]
// pairs per category, in family (lean) order -5 → +5.
export const NATIONAL_BASELINES_1953: Record<
  PoliticalMetricsCountryId,
  Record<PoliticalMetricId, PoliticalMetricBaseline>
> = {
  US: buildBaselines({
    economy: [
      [61, -1.8],
      [67, 0.7],
      [72, 1.4],
      [58, -2.1],
      [76, 2.6],
      [63, -0.5],
      [70, 0.9],
    ],
    education: [
      [54, 0.6],
      [62, 1.1],
      [59, 0.8],
      [66, 1.3],
      [71, 2.2],
      [64, 0.2],
      [57, 0.4],
    ],
    health: [
      [52, 0.9],
      [57, 1.2],
      [63, 2.4],
      [68, 1.6],
      [61, -0.3],
      [72, 0.8],
      [69, 1.1],
    ],
    infrastructure: [
      [48, 0.4],
      [55, -1.2],
      [64, 2.8],
      [62, 0.6],
      [69, 3.1],
      [74, 2.4],
      [66, 0.7],
    ],
    order: [
      [56, -0.6],
      [58, 0.5],
      [65, 0.3],
      [71, 0.8],
      [62, -0.9],
      [68, 0.6],
      [63, 0.2],
    ],
    environment: [
      [43, -1.4],
      [57, 1.0],
      [46, -2.2],
      [67, 1.5],
      [72, 2.0],
      [70, 0.9],
      [74, 1.2],
    ],
    society: [
      [38, 1.9],
      [47, 1.1],
      [61, 0.8],
      [78, 2.6],
      [72, 0.5],
      [76, 0.4],
      [81, -0.3],
    ],
    governance: [
      [59, 0.4],
      [66, -1.1],
      [70, 0.5],
      [63, 0.8],
      [67, 0.6],
      [74, 1.9],
      [77, 0.5],
    ],
    defense: [
      [62, 2.8],
      [68, 0.9],
      [71, 1.4],
      [64, -1.6],
      [79, 3.2],
      [74, -2.1],
      [82, 2.5],
    ],
  }),
  UK: buildBaselines({
    economy: [
      [69, 0.8],
      [61, 0.5],
      [58, 1.9],
      [54, -1.2],
      [57, 0.6],
      [49, -1.8],
      [52, 0.3],
    ],
    education: [
      [63, 1.4],
      [60, 0.7],
      [56, 0.9],
      [64, 1.0],
      [66, 0.8],
      [71, 0.3],
      [62, -0.4],
    ],
    health: [
      [74, 1.6],
      [69, 0.9],
      [72, 1.8],
      [77, 1.2],
      [59, -0.7],
      [62, 0.4],
      [54, -1.1],
    ],
    infrastructure: [
      [71, 2.9],
      [59, -0.8],
      [67, 1.7],
      [57, -0.5],
      [52, 0.8],
      [58, 1.5],
      [49, -0.6],
    ],
    order: [
      [64, 0.5],
      [67, 1.0],
      [78, 0.4],
      [74, 0.7],
      [66, -0.3],
      [63, 0.1],
      [59, -0.2],
    ],
    environment: [
      [41, -2.6],
      [59, 0.6],
      [37, -3.4],
      [61, 0.9],
      [66, 1.1],
      [53, -1.5],
      [56, 0.2],
    ],
    society: [
      [51, 0.7],
      [49, 0.9],
      [47, 0.6],
      [69, 1.4],
      [74, 0.2],
      [72, -0.5],
      [79, -0.8],
    ],
    governance: [
      [72, 0.3],
      [69, 0.5],
      [61, -0.4],
      [76, 0.6],
      [78, 0.8],
      [68, 1.2],
      [81, 0.4],
    ],
    defense: [
      [66, 0.7],
      [74, 0.5],
      [73, -0.9],
      [61, -1.3],
      [64, 0.8],
      [62, -1.7],
      [57, -2.4],
    ],
  }),
  RU: buildBaselines({
    economy: [
      [81, 0.6],
      [58, 1.2],
      [44, 1.8],
      [62, 0.4],
      [74, 3.4],
      [66, 0.8],
      [31, -0.5],
    ],
    education: [
      [76, 2.1],
      [68, 1.6],
      [71, 2.4],
      [69, 2.8],
      [73, 3.0],
      [70, 0.9],
      [42, 0.3],
    ],
    health: [
      [64, 2.2],
      [57, 1.4],
      [61, 2.7],
      [52, 1.8],
      [66, 0.7],
      [38, 0.2],
      [47, 0.5],
    ],
    infrastructure: [
      [59, 3.1],
      [66, 2.4],
      [47, 3.6],
      [51, 1.2],
      [62, 2.8],
      [28, 0.4],
      [24, 0.1],
    ],
    order: [
      [26, 0.8],
      [34, 0.6],
      [43, -0.4],
      [58, 0.9],
      [54, 0.5],
      [77, 0.3],
      [84, -1.2],
    ],
    environment: [
      [33, -1.8],
      [48, 1.4],
      [31, -2.4],
      [64, 2.1],
      [71, 3.3],
      [52, 0.6],
      [68, 1.0],
    ],
    society: [
      [56, 0.4],
      [72, 1.1],
      [63, 1.8],
      [74, 1.3],
      [69, 0.7],
      [58, -0.4],
      [71, 0.9],
    ],
    governance: [
      [38, -2.4],
      [29, -3.1],
      [41, -1.6],
      [64, 0.5],
      [78, 0.8],
      [82, -4.2],
      [86, -1.9],
    ],
    defense: [
      [47, 1.6],
      [52, 1.1],
      [63, 2.2],
      [71, 0.9],
      [76, 3.8],
      [88, 0.5],
      [72, 4.1],
    ],
  }),
  DD: buildBaselines({
    // DD = the year of the June uprising: guaranteed work and party authority
    // strong, consumption and legitimacy strained, reconstruction everywhere,
    // Republikflucht bleeding the demographic west (design: RU's fabric at a
    // smaller, more damaged, more contested scale).
    economy: [
      [78, 0.8],
      [60, 1.4],
      [41, 2.2],
      [55, 0.9],
      [64, 3.0],
      [61, 0.7],
      [38, -0.8],
    ],
    education: [
      [72, 2.0],
      [66, 1.8],
      [69, 2.2],
      [74, 1.6],
      [64, 2.4],
      [68, 0.8],
      [41, 0.3],
    ],
    health: [
      [66, 2.0],
      [58, 1.2],
      [63, 2.2],
      [55, 1.5],
      [64, 0.6],
      [40, 0.3],
      [48, 0.5],
    ],
    infrastructure: [
      [48, 3.4],
      [61, 2.0],
      [52, 2.6],
      [42, 1.5],
      [57, 2.4],
      [31, 0.5],
      [26, 0.2],
    ],
    order: [
      [28, 0.6],
      [38, 0.8],
      [40, -0.6],
      [60, 0.8],
      [56, 0.5],
      [72, 1.5],
      [70, 2.0],
    ],
    environment: [
      [36, -1.2],
      [46, 1.0],
      [27, -2.0],
      [58, 2.4],
      [66, 2.6],
      [54, 0.6],
      [64, 0.9],
    ],
    society: [
      [62, 1.2],
      [70, 1.4],
      [64, 1.6],
      [52, -1.8],
      [66, 1.0],
      [60, -0.3],
      [55, 0.6],
    ],
    governance: [
      [40, -1.5],
      [31, -2.6],
      [38, -1.2],
      [60, 0.6],
      [74, 1.0],
      [76, -2.0],
      [80, -1.0],
    ],
    defense: [
      [50, 1.4],
      [56, 1.8],
      [54, 1.6],
      [58, 2.4],
      [52, 2.8],
      [44, 4.5],
      [38, 2.0],
    ],
  }),
};
