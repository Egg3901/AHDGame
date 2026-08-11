import type { CommodityType } from "@/lib/constants/commodities";
import { TRADE_EXPORT_PREMIUM_RATE, TRADE_EXPORT_PREMIUM_CAP } from "./constants";

/**
 * Margin premium (percentage points) a sector earns for producing commodities
 * its country actually exports into foreign deficits. This is the "export
 * reward" leg of attribution: a producing sector's share of the national export
 * is rewarded in proportion to how much of its output clears abroad.
 *
 *   premium = Σ_commodity (supplyRate × exportIntensity) × RATE, clamped to CAP
 *
 * `supplyRates` are the sector's effective per-commodity output rates (strategy
 * rates or SECTOR_SUPPLY). `exportIntensity[commodity]` ∈ [0,1] is the fraction
 * of the country's surplus of that commodity that cleared abroad last turn.
 * Pure.
 */
export function computeExportPremium(
  supplyRates: Partial<Record<CommodityType, number>> | undefined | null,
  exportIntensity: ReadonlyMap<CommodityType, number>
): number {
  if (!supplyRates) return 0;
  let premium = 0;
  for (const [commodity, rate] of Object.entries(supplyRates) as Array<[CommodityType, number]>) {
    if (!rate || rate <= 0) continue;
    const intensity = exportIntensity.get(commodity) ?? 0;
    if (intensity <= 0) continue;
    premium += rate * intensity * TRADE_EXPORT_PREMIUM_RATE;
  }
  return Math.min(TRADE_EXPORT_PREMIUM_CAP, Math.round(premium * 100) / 100);
}

/**
 * Supply-weighted fraction of a sector's output that clears abroad — i.e. the
 * cross-border-exposed share of its revenue. Used by the trade-exposure embargo
 * model to scale away only the export leg of a sector under a total embargo,
 * leaving domestic host sales intact. Returns a value in [0,1]; 0 when the
 * sector produces nothing or nothing it makes is exported. Pure.
 */
export function computeExportExposure(
  supplyRates: Partial<Record<CommodityType, number>> | undefined | null,
  exportIntensity: ReadonlyMap<CommodityType, number>
): number {
  if (!supplyRates) return 0;
  let weightedIntensity = 0;
  let totalRate = 0;
  for (const [commodity, rate] of Object.entries(supplyRates) as Array<[CommodityType, number]>) {
    if (!rate || rate <= 0) continue;
    totalRate += rate;
    const intensity = exportIntensity.get(commodity) ?? 0;
    weightedIntensity += rate * Math.max(0, Math.min(1, intensity));
  }
  if (totalRate <= 0) return 0;
  return Math.max(0, Math.min(1, weightedIntensity / totalRate));
}
