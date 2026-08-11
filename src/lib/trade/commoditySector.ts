import { SECTOR_SUPPLY, type CommodityType } from "@/lib/constants/commodities";
import type { CorporationType } from "@/lib/constants/corporations";

/**
 * The sector type that primarily produces each commodity — the highest
 * supply-rate producer in SECTOR_SUPPLY. Used to map a commodity's import flow
 * to the importer's tariff on that sector type (the tariff→flow drag). Derived
 * once at module load so it stays in sync with the supply recipes.
 */
export const PRIMARY_SECTOR_BY_COMMODITY: Partial<Record<CommodityType, CorporationType>> = (() => {
  const best: Partial<Record<CommodityType, { sector: CorporationType; rate: number }>> = {};
  for (const [sector, flows] of Object.entries(SECTOR_SUPPLY) as Array<
    [CorporationType, ReadonlyArray<{ commodity: CommodityType; rate: number }>]
  >) {
    for (const f of flows ?? []) {
      const cur = best[f.commodity];
      if (!cur || f.rate > cur.rate) best[f.commodity] = { sector, rate: f.rate };
    }
  }
  const out: Partial<Record<CommodityType, CorporationType>> = {};
  for (const [commodity, v] of Object.entries(best) as Array<
    [CommodityType, { sector: CorporationType; rate: number }]
  >) {
    out[commodity] = v.sector;
  }
  return out;
})();
