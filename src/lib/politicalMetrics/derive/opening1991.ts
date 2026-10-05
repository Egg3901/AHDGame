import { getRegionMetricPresets } from "@/lib/seeds/metricPresets";
import { loadSeededStateMetrics } from "@/lib/states/conditions/seedMetricsLoader";
import { US_GEOGRAPHY } from "@/lib/countries/us/geography";
import { UK_GEOGRAPHY } from "@/lib/countries/uk/geography";
import { deriveCountryBoard } from "./deriveFamilies";
import type { PoliticalMetricId } from "../types";

export const TEXTURE_1991_BOUND = 12;
export function deriveRegionalTexture1991() {
  const result: Record<string, Record<string, Partial<Record<PoliticalMetricId, number>>>> = {};
  for (const cc of ["US", "UK"] as const) {
    const geography = cc === "US" ? US_GEOGRAPHY : UK_GEOGRAPHY;
    const regions = geography.regionBundles["1991-default"];
    if (!regions?.length) throw new Error(`Missing ${cc} 1991 regions`);
    const populations = new Map(regions.map((region) => [region._id, region.population]));
    const boards = loadSeededStateMetrics(cc, "1991-default")
      .filter((metrics) => populations.has(String(metrics._id)))
      .map((metrics) => {
        const flat: Record<string, number> = {};
        for (const [category, entries] of Object.entries(metrics)) {
          if (entries == null || typeof entries !== "object") continue;
          for (const [id, metric] of Object.entries(entries)) {
            const value = (metric as { value?: number })?.value;
            if (typeof value === "number" && Number.isFinite(value))
              flat[`${category}.${id}`] = value;
          }
        }
        // US legacy bundles jitter at module load. Derive its texture only
        // from explicit 1991 preset cells, so codegen never freezes random noise.
        if (cc === "US") {
          const authored = getRegionMetricPresets(cc, String(metrics._id), "1991-default");
          for (const path of Object.keys(flat)) delete flat[path];
          Object.assign(flat, authored);
        }
        return {
          id: String(metrics._id),
          population: populations.get(String(metrics._id)) ?? 0,
          board: deriveCountryBoard({ countryId: cc, legacy: flat, macro: flat, year: 1991 }),
        };
      });
    if (!boards.length) throw new Error(`Missing ${cc} 1991 metric inputs`);
    const country: Record<string, Partial<Record<PoliticalMetricId, number>>> = {};
    for (const region of boards) country[region.id] = {};
    for (const id of Object.keys(boards[0].board.values) as PoliticalMetricId[]) {
      // National defense posture has no regional legacy source and remains national.
      if (id.startsWith("defense.") || boards.some((region) => !region.board.values[id])) continue;
      const total = boards.reduce((sum, region) => sum + region.population, 0);
      const mean =
        boards.reduce((sum, region) => sum + region.board.values[id].value * region.population, 0) /
        total;
      const deviations = boards.map((region) => region.board.values[id].value - mean);
      const max = Math.max(...deviations.map(Math.abs));
      const scale = max > TEXTURE_1991_BOUND ? TEXTURE_1991_BOUND / max : 1;
      boards.forEach((region, index) => {
        const value = Math.round(deviations[index] * scale * 10) / 10;
        if (value !== 0) country[region.id][id] = value;
      });
    }
    result[cc] = country;
  }
  return result;
}
