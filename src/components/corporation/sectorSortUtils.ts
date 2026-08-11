import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import type { SectorDetail } from "./CorporationPageTypes";

export type SectorSortKey =
  | "location"
  | "type"
  | "growthRate"
  | "growthCost"
  | "revenue"
  | "margin"
  | "profit"
  | "workers"
  // Plants tier only.
  | "capacity"
  | "fill";

export type SortDir = "asc" | "desc";

/** Sort options for a capital-tier (growth-slider) world. */
export const SORT_OPTIONS: { value: SectorSortKey; label: string }[] = [
  { value: "location", label: "Location" },
  { value: "type", label: "Sector type" },
  { value: "growthRate", label: "Growth target %" },
  { value: "growthCost", label: "Growth cost / day" },
  { value: "revenue", label: "Revenue / day" },
  { value: "margin", label: "Effective margin %" },
  { value: "profit", label: "Profit / day" },
  { value: "workers", label: "Workers" },
];

/**
 * Sort options for a plants world.
 *
 * Growth target and growth cost are gone, not renamed: under plants the growth
 * slider does not drive capacity, so sorting by it ranks holdings on a number
 * that no longer means anything. Capacity and fill take their place, and they
 * lead — "which plants are big" and "which plants cannot sell what they make"
 * are the two questions the table exists to answer.
 */
export const PLANTS_SORT_OPTIONS: { value: SectorSortKey; label: string }[] = [
  { value: "location", label: "Location" },
  { value: "type", label: "Sector type" },
  { value: "capacity", label: "Capacity (units/day)" },
  { value: "fill", label: "Fill %" },
  { value: "revenue", label: "Revenue / day" },
  { value: "margin", label: "Effective margin %" },
  { value: "profit", label: "Profit / day" },
  { value: "workers", label: "Workers" },
];

/** The sort list for the given world. */
export function sortOptionsFor(plantsMode: boolean): { value: SectorSortKey; label: string }[] {
  return plantsMode ? PLANTS_SORT_OPTIONS : SORT_OPTIONS;
}

/**
 * Sort a nullable numeric field.
 *
 * Absent values (redacted rows, sectors that have not run a plants turn yet)
 * sort as the LOWEST value in either direction rather than being compared as
 * NaN — a NaN comparison returns 0 for every pair, which silently disables the
 * sort entirely instead of just misplacing the blank rows.
 */
function compareNullable(a: number | null | undefined, b: number | null | undefined): number {
  const av = a == null || !Number.isFinite(a) ? Number.NEGATIVE_INFINITY : a;
  const bv = b == null || !Number.isFinite(b) ? Number.NEGATIVE_INFINITY : b;
  if (av === bv) return 0;
  return av < bv ? -1 : 1;
}

export function compareSectors(
  a: SectorDetail,
  b: SectorDetail,
  key: SectorSortKey,
  dir: SortDir
): number {
  const sign = dir === "asc" ? 1 : -1;
  switch (key) {
    case "location":
      return a.stateName.localeCompare(b.stateName, undefined, { sensitivity: "base" }) * sign;
    case "type": {
      const la = CORPORATION_TYPE_LABELS[a.sectorType as CorporationType];
      const lb = CORPORATION_TYPE_LABELS[b.sectorType as CorporationType];
      return la.localeCompare(lb, undefined, { sensitivity: "base" }) * sign;
    }
    case "growthRate":
      return (a.targetGrowthRate - b.targetGrowthRate) * sign;
    case "growthCost":
      return (a.currentGrowthCost - b.currentGrowthCost) * sign;
    case "revenue":
      return (a.revenue - b.revenue) * sign;
    case "margin":
      return (a.effectiveProfitMargin - b.effectiveProfitMargin) * sign;
    case "profit":
      return (a.profit - b.profit) * sign;
    case "workers":
      return (a.workers - b.workers) * sign;
    case "capacity":
      return compareNullable(a.capacityUnits, b.capacityUnits) * sign;
    case "fill":
      // Sorts on the exact rate the viewer holds. A rival without it sorts all
      // such rows together at the bottom rather than by band — banding is a
      // disclosure limit, and reconstructing an order from it would leak more
      // than the band is meant to give away.
      return compareNullable(a.fillRate, b.fillRate) * sign;
    default:
      return 0;
  }
}

export function sortSectors(
  list: SectorDetail[],
  key: SectorSortKey,
  dir: SortDir
): SectorDetail[] {
  return [...list].sort((a, b) => {
    const c = compareSectors(a, b, key, dir);
    if (c !== 0) return c;
    return a.stateName.localeCompare(b.stateName, undefined, { sensitivity: "base" });
  });
}
