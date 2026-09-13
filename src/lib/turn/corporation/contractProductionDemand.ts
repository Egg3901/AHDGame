import { commodityMixWeight, type CommodityType } from "@/lib/constants/commodities";
import { parseSupplyAgreementScopeKey } from "@/lib/market/commodityMarketScope";

export interface ContractProductionTargetSector {
  sectorId: string;
  corporationId: string;
  stateId?: string | null;
  capacityUnits?: number | null;
  supplyRates: Partial<Record<CommodityType, number>>;
  mothballed?: boolean | null;
}

/**
 * Allocate named-buyer demand to the supplier's sectors before production.
 *
 * Clearing reservations are corporation-wide for most commodities and state
 * scoped for freight. A sector produces one scalar output stream that is split
 * across its recipe, so a sector can carry several contract requirements at
 * once. Requirements for the same commodity add; requirements for different
 * commodities take the larger scalar run because one run produces both mixes.
 */
export function computeContractProductionTargets(args: {
  reservations: ReadonlyMap<string, ReadonlyMap<string, number>>;
  sectors: readonly ContractProductionTargetSector[];
  basePrices: Record<CommodityType, number>;
}): Map<string, number> {
  const sectorsByCorp = new Map<string, ContractProductionTargetSector[]>();
  const sectorById = new Map<string, ContractProductionTargetSector>();
  for (const sector of args.sectors) {
    sectorById.set(sector.sectorId, sector);
    const byCorp = sectorsByCorp.get(sector.corporationId) ?? [];
    byCorp.push(sector);
    sectorsByCorp.set(sector.corporationId, byCorp);
  }

  const requiredBySector = new Map<string, Map<CommodityType, number>>();
  for (const [corporationId, byScope] of args.reservations) {
    const sectors = sectorsByCorp.get(corporationId) ?? [];
    for (const [scopeKey, reservedUnits] of byScope) {
      if (!(reservedUnits > 0)) continue;
      const { commodity, stateId } = parseSupplyAgreementScopeKey(scopeKey);
      const candidates = sectors.filter(
        (sector) =>
          sector.mothballed !== true &&
          (stateId === undefined || sector.stateId === stateId) &&
          typeof sector.capacityUnits === "number" &&
          Number.isFinite(sector.capacityUnits) &&
          sector.capacityUnits > 0
      );

      const weightedCapacity = candidates.reduce((sum, sector) => {
        const weight = commodityMixWeight(sector.supplyRates, args.basePrices, commodity);
        return sum + sector.capacityUnits! * weight;
      }, 0);
      if (!(weightedCapacity > 0)) continue;

      for (const sector of candidates) {
        const weight = commodityMixWeight(sector.supplyRates, args.basePrices, commodity);
        if (!(weight > 0)) continue;
        const commodityUnits =
          reservedUnits * ((sector.capacityUnits! * weight) / weightedCapacity);
        const byCommodity =
          requiredBySector.get(sector.sectorId) ?? new Map<CommodityType, number>();
        byCommodity.set(commodity, (byCommodity.get(commodity) ?? 0) + commodityUnits);
        requiredBySector.set(sector.sectorId, byCommodity);
      }
    }
  }

  const targets = new Map<string, number>();
  for (const [sectorId, requirements] of requiredBySector) {
    const sector = sectorById.get(sectorId);
    if (!sector) continue;
    let scalarTarget = 0;
    for (const [commodity, requiredUnits] of requirements) {
      const weight = commodityMixWeight(sector.supplyRates, args.basePrices, commodity);
      if (weight > 0) scalarTarget = Math.max(scalarTarget, requiredUnits / weight);
    }
    if (scalarTarget > 0) targets.set(sectorId, scalarTarget);
  }
  return targets;
}
