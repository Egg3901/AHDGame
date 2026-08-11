import type { CorporationType } from "@/lib/constants/corporations";
import { EXTRACTABLE_RESOURCES, type ExtractableResource } from "@/lib/constants/commodities";

type SupplyRates = Partial<Record<string, number>>;

/**
 * Resource-capacity docs are authoritative when present: extraction sectors
 * cannot claim commodity supply for resources their operating state does not
 * actually have. Missing docs mean legacy/uncapped state data.
 */
export function applyExtractionResourceCapacityToSupply<T extends SupplyRates>(
  sectorType: CorporationType,
  supplyRates: T,
  stateResources: Partial<Record<ExtractableResource, number>> | null | undefined
): T {
  if (sectorType !== "extraction" || stateResources === undefined) return supplyRates;

  const filtered: SupplyRates = { ...supplyRates };
  for (const resource of EXTRACTABLE_RESOURCES) {
    if ((filtered[resource] ?? 0) > 0 && (stateResources?.[resource] ?? 0) <= 0) {
      filtered[resource] = 0;
    }
  }

  return filtered as T;
}
