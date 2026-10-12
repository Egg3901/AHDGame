import type { State } from "@/lib/db/types/state";
import { getPath, scaleDeep } from "../../secede/docScale";
export function redenominatePublicRegion(state: State, scale: number): Record<string, unknown> {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid public currency scale");
  const set: Record<string, unknown> = {};
  const fields = [
    "gdp",
    "capitalStock",
    "sectorRevenueEma",
    "sectorRealizedRevenue",
    "subhourBase.growth.gdp",
    "conflictCapacityApplied",
  ];
  for (const field of fields) {
    const value = getPath(state as unknown as Record<string, unknown>, field);
    if (value !== undefined) set[field] = scaleDeep(value, scale);
  }
  if (state.sectorRevenueSnapshots)
    set.sectorRevenueSnapshots = state.sectorRevenueSnapshots.map((point) => ({
      ...point,
      value: point.value * scale,
    }));
  return set;
}
