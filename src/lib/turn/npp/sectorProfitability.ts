import type { CorporateSector } from "@/lib/db/types";

export interface SectorProfitInfo {
  sector: CorporateSector;
  income: number;
  margin: number;
  isProfitable: boolean;
  marginCategory: "loss" | "thin" | "healthy" | "strong";
}

/** Classifies the last measured result of each sector for NPP decisions. */
export function analyzeSectorProfitability(
  sectors: CorporateSector[],
  preferPhysicalPnl = false
): SectorProfitInfo[] {
  return sectors.map((sector) => {
    const physicalPnl = preferPhysicalPnl ? sector.plantsPnl : undefined;
    const revenue = physicalPnl?.revenue ?? sector.revenue ?? 0;
    const margin =
      physicalPnl && physicalPnl.revenue > 0
        ? (100 * physicalPnl.profit) / physicalPnl.revenue
        : (sector.effectiveProfitMargin ?? sector.profitMargin ?? 0);
    const income = physicalPnl?.profit ?? revenue * (margin / 100);
    const isProfitable = income > 0;
    const marginCategory: SectorProfitInfo["marginCategory"] =
      margin < 0 ? "loss" : margin < 10 ? "thin" : margin < 25 ? "healthy" : "strong";
    return { sector, income, margin, isProfitable, marginCategory };
  });
}
