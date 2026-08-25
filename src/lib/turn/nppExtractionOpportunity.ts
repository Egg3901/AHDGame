import type { CorporateSector } from "@/lib/db/types";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import {
  COMMODITY_BASE_PRICES,
  EXTRACTABLE_RESOURCES,
  type ExtractableResource,
} from "@/lib/constants/commodities";
import { extractionDesiredUnits } from "@/lib/extraction/capacityHaircut";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";

export function computeExtractionHeadroomByState(
  capDocs: Array<Pick<StateResourceCapacity, "stateId" | "resources">>,
  sectors: CorporateSector[],
  eraUnitScale: number,
  extractionOutputScaleEnabled: boolean
): Map<string, number> {
  const desiredByState = new Map<string, Partial<Record<ExtractableResource, number>>>();
  for (const sector of sectors) {
    if (sector.sectorType !== "extraction") continue;
    const strat =
      SECTOR_STRATEGIES["extraction"]?.find((st) => st.id === (sector.strategyId ?? "standard")) ??
      SECTOR_STRATEGIES["extraction"]?.[0];
    const supplyRates = (strat?.supply ?? {}) as Partial<Record<string, number>>;
    const forState = desiredByState.get(sector.stateId) ?? {};
    for (const resource of EXTRACTABLE_RESOURCES) {
      const rate = supplyRates[resource] ?? 0;
      if (rate <= 0) continue;
      forState[resource] =
        (forState[resource] ?? 0) +
        extractionDesiredUnits(
          sector.revenue,
          rate,
          resource,
          eraUnitScale,
          extractionOutputScaleEnabled
        );
    }
    desiredByState.set(sector.stateId, forState);
  }

  const headroomByState = new Map<string, number>();
  for (const capDoc of capDocs) {
    let capValue = 0;
    let headroomValue = 0;
    for (const resource of EXTRACTABLE_RESOURCES) {
      const capacity = capDoc.resources?.[resource] ?? 0;
      if (capacity <= 0) continue;
      const basePrice = COMMODITY_BASE_PRICES[resource] ?? 1;
      const desired = desiredByState.get(capDoc.stateId)?.[resource] ?? 0;
      capValue += capacity * basePrice;
      headroomValue += Math.max(0, capacity - desired) * basePrice;
    }
    headroomByState.set(capDoc.stateId, capValue > 0 ? headroomValue / capValue : 0);
  }
  return headroomByState;
}
