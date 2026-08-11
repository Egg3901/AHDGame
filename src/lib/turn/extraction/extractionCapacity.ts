import type { ExtractableResource } from "@/lib/constants/commodities";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import type { ObjectId } from "mongodb";

export interface ExtractionSectorInput {
  sectorId: string;
  stateId: string;
  corporationId: ObjectId;
  /**
   * Unconstrained revenue-based output per resource, in units on the DAILY basis
   * (derived from `sector.revenue`, which is daily). Not per game turn — see
   * StateResourceCapacity for the same note.
   */
  revenueBasedOutput: Partial<Record<ExtractableResource, number>>;
}

/**
 * Compute capacity multipliers (0.0–1.0) per sector per resource.
 *
 * Contract-holders are capped to their allocated share of state capacity.
 * Non-contracted (open-access) sectors share the remaining pool proportionally.
 * States with no capacity document are uncapped (multiplier = 1).
 */
export function computeExtractionCapacityMultipliers(
  sectors: ExtractionSectorInput[],
  contracts: ExtractionContract[],
  capacities: StateResourceCapacity[]
): Map<string, Partial<Record<ExtractableResource, number>>> {
  const result = new Map<string, Partial<Record<ExtractableResource, number>>>();

  const capacityByState = new Map<string, StateResourceCapacity>();
  for (const cap of capacities) {
    capacityByState.set(cap.stateId, cap);
  }

  // Index active contracts: stateId → resource → corporationId string → share
  const contractIndex = new Map<string, Map<ExtractableResource, Map<string, number>>>();
  for (const contract of contracts) {
    if (!contractIndex.has(contract.stateId)) {
      contractIndex.set(contract.stateId, new Map());
    }
    const byResource = contractIndex.get(contract.stateId)!;
    if (!byResource.has(contract.resource)) {
      byResource.set(contract.resource, new Map());
    }
    byResource.get(contract.resource)!.set(contract.corporationId.toString(), contract.share);
  }

  const sectorsByState = new Map<string, ExtractionSectorInput[]>();
  for (const sector of sectors) {
    if (!sectorsByState.has(sector.stateId)) sectorsByState.set(sector.stateId, []);
    sectorsByState.get(sector.stateId)!.push(sector);
  }

  for (const [stateId, stateSectors] of sectorsByState) {
    const capDoc = capacityByState.get(stateId);

    if (!capDoc) {
      for (const sector of stateSectors) {
        result.set(sector.sectorId, buildOnesMap(sector.revenueBasedOutput));
      }
      continue;
    }

    const contractsByResource = contractIndex.get(stateId);

    for (const resource of EXTRACTABLE_RESOURCES) {
      const totalCapacity = capDoc.resources[resource] ?? 0;

      if (totalCapacity <= 0) {
        for (const sector of stateSectors) {
          setMultiplier(result, sector.sectorId, resource, 0);
        }
        continue;
      }

      const contractsForResource = contractsByResource?.get(resource);
      const contractedShareSum = contractsForResource
        ? [...contractsForResource.values()].reduce((a, b) => a + b, 0)
        : 0;
      const openAccessPool = Math.max(0, totalCapacity * (1 - contractedShareSum));

      const contracted: ExtractionSectorInput[] = [];
      const openAccess: ExtractionSectorInput[] = [];
      for (const sector of stateSectors) {
        const hasContract = contractsForResource?.has(sector.corporationId.toString()) ?? false;
        if (hasContract) contracted.push(sector);
        else openAccess.push(sector);
      }

      for (const sector of contracted) {
        const share = contractsForResource!.get(sector.corporationId.toString())!;
        const allocatedCap = totalCapacity * share;
        const output = sector.revenueBasedOutput[resource] ?? 0;
        const multiplier = output > 0 ? Math.min(1, allocatedCap / output) : 1;
        setMultiplier(result, sector.sectorId, resource, multiplier);
      }

      const totalOADemand = openAccess.reduce(
        (sum, s) => sum + (s.revenueBasedOutput[resource] ?? 0),
        0
      );
      for (const sector of openAccess) {
        const output = sector.revenueBasedOutput[resource] ?? 0;
        if (openAccessPool <= 0 || output <= 0) {
          setMultiplier(result, sector.sectorId, resource, openAccessPool <= 0 ? 0 : 1);
        } else if (totalOADemand <= openAccessPool) {
          setMultiplier(result, sector.sectorId, resource, 1);
        } else {
          setMultiplier(result, sector.sectorId, resource, openAccessPool / totalOADemand);
        }
      }
    }
  }

  return result;
}

function setMultiplier(
  map: Map<string, Partial<Record<ExtractableResource, number>>>,
  sectorId: string,
  resource: ExtractableResource,
  multiplier: number
): void {
  if (!map.has(sectorId)) map.set(sectorId, {});
  map.get(sectorId)![resource] = multiplier;
}

function buildOnesMap(
  output: Partial<Record<ExtractableResource, number>>
): Partial<Record<ExtractableResource, number>> {
  const result: Partial<Record<ExtractableResource, number>> = {};
  for (const resource of Object.keys(output) as ExtractableResource[]) {
    result[resource] = 1;
  }
  return result;
}
