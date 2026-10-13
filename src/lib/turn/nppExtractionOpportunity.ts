import type { CorporateSector } from "@/lib/db/types";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import {
  COMMODITY_BASE_PRICES,
  EXTRACTABLE_RESOURCES,
  type ExtractableResource,
} from "@/lib/constants/commodities";
import { extractionDesiredUnits } from "@/lib/extraction/capacityHaircut";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";

/** Per state, the unclaimed share of each resource deposit the state holds. */
export type ExtractionResourceHeadroom = Partial<Record<ExtractableResource, number>>;

/** ₳ revenue of a sector; see `extractionRevenueAnchorOf` for why not `revenue`. */
export type SectorRevenueAnchorOf = (sector: CorporateSector) => number;

function desiredExtractionByState(
  sectors: CorporateSector[],
  eraUnitScale: number,
  extractionOutputScaleEnabled: boolean,
  revenueAnchorOf: SectorRevenueAnchorOf
): Map<string, Partial<Record<ExtractableResource, number>>> {
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
          revenueAnchorOf(sector),
          rate,
          resource,
          eraUnitScale,
          extractionOutputScaleEnabled
        );
    }
    desiredByState.set(sector.stateId, forState);
  }
  return desiredByState;
}

/**
 * Per state and resource, the unclaimed fraction of that deposit in [0, 1].
 * A resource the state holds no deposit of is absent (read as 0); a state with
 * no capacity document is absent from the map (read as uncapped).
 */
export function computeExtractionHeadroomByStateResource(
  capDocs: Array<Pick<StateResourceCapacity, "stateId" | "resources">>,
  sectors: CorporateSector[],
  eraUnitScale: number,
  extractionOutputScaleEnabled: boolean,
  revenueAnchorOf: SectorRevenueAnchorOf
): Map<string, ExtractionResourceHeadroom> {
  const desiredByState = desiredExtractionByState(
    sectors,
    eraUnitScale,
    extractionOutputScaleEnabled,
    revenueAnchorOf
  );
  const headroomByState = new Map<string, ExtractionResourceHeadroom>();
  for (const capDoc of capDocs) {
    const byResource: ExtractionResourceHeadroom = {};
    for (const resource of EXTRACTABLE_RESOURCES) {
      const capacity = capDoc.resources?.[resource] ?? 0;
      if (capacity <= 0) continue;
      const desired = desiredByState.get(capDoc.stateId)?.[resource] ?? 0;
      byResource[resource] = Math.max(0, capacity - desired) / capacity;
    }
    headroomByState.set(capDoc.stateId, byResource);
  }
  return headroomByState;
}

export function computeExtractionHeadroomByState(
  capDocs: Array<Pick<StateResourceCapacity, "stateId" | "resources">>,
  sectors: CorporateSector[],
  eraUnitScale: number,
  extractionOutputScaleEnabled: boolean,
  revenueAnchorOf: SectorRevenueAnchorOf
): Map<string, number> {
  const byResource = computeExtractionHeadroomByStateResource(
    capDocs,
    sectors,
    eraUnitScale,
    extractionOutputScaleEnabled,
    revenueAnchorOf
  );
  const headroomByState = new Map<string, number>();
  for (const capDoc of capDocs) {
    let capValue = 0;
    let headroomValue = 0;
    for (const resource of EXTRACTABLE_RESOURCES) {
      const capacity = capDoc.resources?.[resource] ?? 0;
      if (capacity <= 0) continue;
      const basePrice = COMMODITY_BASE_PRICES[resource] ?? 1;
      capValue += capacity * basePrice;
      headroomValue += capacity * (byResource.get(capDoc.stateId)?.[resource] ?? 0) * basePrice;
    }
    headroomByState.set(capDoc.stateId, capValue > 0 ? headroomValue / capValue : 0);
  }
  return headroomByState;
}

/**
 * Deposit headroom for a mine that extracts `supply`: the output-value weighted
 * headroom of the resources in its recipe. A recipe whose resources the state
 * holds none of reads 0, so a mine on the wrong deposit never looks like room
 * to grow just because the state has some other resource to spare.
 */
export function extractionHeadroomForSupply(
  supply: Partial<Record<string, number>>,
  resourceHeadroomOf: (resource: ExtractableResource) => number
): number {
  let weight = 0;
  let weighted = 0;
  for (const resource of EXTRACTABLE_RESOURCES) {
    const rate = supply[resource] ?? 0;
    if (!(rate > 0)) continue;
    const value = rate * (COMMODITY_BASE_PRICES[resource] ?? 1);
    weight += value;
    weighted += value * Math.max(0, Math.min(1, resourceHeadroomOf(resource)));
  }
  return weight > 0 ? weighted / weight : 0;
}
