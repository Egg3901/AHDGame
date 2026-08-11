import type { StateMetricBaseline } from "@/lib/db/types";
import { metricCategories } from "@/lib/constants/metricDefinitions";

// Generate a baseline value in the 40-60 range with some state variation
function generateBaseline(stateIndex: number, metricIndex: number): number {
  // Use deterministic "randomness" based on indices for reproducibility
  const seed = (stateIndex * 17 + metricIndex * 31) % 100;
  return 40 + (seed % 21); // 40-60 range
}

export function generateStateBaselines(stateIds: string[]): StateMetricBaseline[] {
  return stateIds.map((stateId, stateIndex) => {
    const baselines: Record<string, Record<string, number>> = {};

    metricCategories.forEach((category, catIndex) => {
      baselines[category.id] = {};
      category.metrics.forEach((metric, metricIndex) => {
        baselines[category.id][metric.id] = generateBaseline(stateIndex + catIndex, metricIndex);
      });
    });

    return {
      _id: stateId,
      baselines,
    };
  });
}

// US state abbreviations
export const US_STATE_IDS = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  // DC was missing from this list entirely (confirmed via seed-audit
  // MCP 2026-07-22: baselines absent for DC in both a fresh world and a
  // 994-turn sandbox, unlike every other collection which had it).
  // Appended rather than alphabetically inserted so every existing state's
  // stateIndex-derived baseline value is unchanged on a reseed.
  "DC",
];

export const stateBaselines = generateStateBaselines(US_STATE_IDS);
