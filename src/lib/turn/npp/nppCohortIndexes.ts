import type { CorporateSector } from "@/lib/db/types";
import type { NPP } from "@/lib/db/types/npp";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import { deriveCeoArchetype, type CeoArchetype } from "@/lib/turn/ceoArchetype";

export function indexNppCohort(ceoNpps: readonly NPP[], sectors: readonly CorporateSector[]) {
  const archetypeByNppId = new Map<string, CeoArchetype>();
  for (const npp of ceoNpps) {
    if (npp.personality)
      archetypeByNppId.set(npp._id.toString(), deriveCeoArchetype(npp.personality));
  }
  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const sector of sectors) {
    const id = sector.corporationId.toString();
    const owned = sectorsByCorp.get(id) ?? [];
    owned.push(sector);
    sectorsByCorp.set(id, owned);
  }
  return { archetypeByNppId, sectorsByCorp };
}

export function indexLatestCommodityPrices(docs: readonly CommodityPrice[]) {
  const byCommodity = new Map<string, CommodityPrice>();
  for (const doc of docs) {
    const existing = byCommodity.get(doc.commodity);
    if (!existing || (doc.turn ?? 0) >= (existing.turn ?? 0)) byCommodity.set(doc.commodity, doc);
  }
  return byCommodity;
}
