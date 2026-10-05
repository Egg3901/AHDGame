import {
  FAMILY_SLUGS,
  POLITICAL_METRIC_CATEGORIES,
  type PoliticalMetricCategoryId,
  type PoliticalMetricId,
  type PoliticalMetricsCountryId,
} from "../types";
import { NATIONAL_BASELINES_1979 } from "./nationalBaselines1979";

type Rows = Record<PoliticalMetricCategoryId, readonly number[]>;
function board(rows: Rows): Record<PoliticalMetricId, number> {
  const result = {} as Record<PoliticalMetricId, number>;
  for (const category of POLITICAL_METRIC_CATEGORIES) {
    if (rows[category.id].length !== 7) throw new Error(`Incomplete 1991 ${category.id} row`);
    FAMILY_SLUGS[category.id].forEach((slug, index) => {
      result[`${category.id}.${slug}` as PoliticalMetricId] = rows[category.id][index];
    });
  }
  return result;
}

/**
 * 1991 v1 game-balance opening, issue3266. Scores describe policy capacity and
 * outcomes, not opinion polling. Regional deviations come from 1991 seeds.
 * US: mature public services and defense, weaker access, safety and fiscal space.
 * UK: recession pressure and uneven services, strong institutional capacity.
 * RU: opening transition crisis, inherited schooling above fiscal/governance capacity.
 * DD has no 1991 playable opening; retain its last authored board for old saves.
 */
export const NATIONAL_BASELINES_1991: Record<
  PoliticalMetricsCountryId,
  Record<PoliticalMetricId, number>
> = {
  US: board({
    economy: [52, 55, 59, 54, 68, 51, 72],
    education: [70, 64, 67, 62, 68, 60, 69],
    health: [58, 64, 62, 57, 67, 61, 65],
    infrastructure: [70, 62, 82, 75, 71, 72, 64],
    order: [53, 62, 68, 72, 52, 45, 59],
    environment: [68, 61, 64, 72, 62, 65, 63],
    society: [56, 52, 68, 60, 57, 69, 64],
    governance: [72, 68, 52, 69, 70, 67, 70],
    defense: [82, 81, 78, 76, 83, 76, 79],
  }),
  UK: board({
    economy: [47, 52, 57, 48, 60, 49, 65],
    education: [66, 61, 62, 54, 63, 58, 64],
    health: [73, 63, 69, 71, 66, 65, 60],
    infrastructure: [72, 62, 84, 70, 66, 65, 62],
    order: [65, 62, 60, 58, 65, 57, 63],
    environment: [64, 61, 66, 67, 62, 62, 63],
    society: [52, 54, 60, 57, 54, 63, 61],
    governance: [69, 66, 54, 63, 67, 64, 65],
    defense: [72, 69, 68, 61, 69, 64, 66],
  }),
  RU: board({
    economy: [34, 31, 29, 24, 43, 28, 38],
    education: [69, 64, 63, 56, 62, 55, 62],
    health: [58, 49, 52, 44, 51, 48, 47],
    infrastructure: [49, 44, 59, 50, 46, 48, 44],
    order: [40, 43, 38, 39, 45, 35, 40],
    environment: [35, 39, 42, 40, 36, 38, 39],
    society: [35, 38, 31, 34, 36, 48, 38],
    governance: [29, 33, 38, 28, 31, 27, 30],
    defense: [56, 45, 38, 34, 41, 36, 40],
  }),
  DD: NATIONAL_BASELINES_1979.DD,
};

/** Political base before regional conditions and public expectations. */
export const OPENING_POLITICAL_APPROVAL_1991: Partial<Record<PoliticalMetricsCountryId, number>> = {
  US: 52,
  UK: 48,
  RU: 43,
};
