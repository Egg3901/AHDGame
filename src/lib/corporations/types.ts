/**
 * Shared corporation API contract types.
 *
 * Response shapes consumed by both API routes (src/app/api/corporations/…)
 * and client components. Living here keeps components from importing API
 * route modules directly (architecture audit: "app/components importing API
 * route modules").
 */
import type { CommodityType } from "@/lib/constants/commodities";

/** One chart point of a corporation's commodity output/share history. */
export interface CommodityHistoryPoint {
  turn: number;
  outputUnits: number;
  globalSupplyUnits: number | null;
  sharePercent: number | null;
  stockUnits: number | null;
}

/** Per-commodity series returned by GET /api/corporations/[id]/commodity-history. */
export interface CommodityHistorySeries {
  commodity: CommodityType;
  label: string;
  icon: string;
  unit: string;
  points: CommodityHistoryPoint[];
}
