import { EXTRACTABLE_RESOURCES, type ExtractableResource } from "@/lib/constants/commodities";
import type { SectorStrategy } from "@/lib/constants/sectorStrategies";

export type StateExtractionResources =
  Partial<Record<ExtractableResource | string, number>> | null | undefined;

export function getExtractionStrategyResources(
  strategy: Pick<SectorStrategy, "supply">
): ExtractableResource[] {
  return EXTRACTABLE_RESOURCES.filter((resource) => (strategy.supply[resource] ?? 0) > 0);
}

/**
 * Returns true when an extraction strategy has no resource it can actually
 * produce in the state. `undefined` means the capacity document is missing, so
 * legacy states remain uncapped instead of being treated as zero-capacity.
 */
export function isExtractionStrategyZeroYield(
  strategy: Pick<SectorStrategy, "supply">,
  stateResources: StateExtractionResources
): boolean {
  if (stateResources === undefined) return false;

  const resources = getExtractionStrategyResources(strategy);
  if (resources.length === 0) return false;

  return resources.every((resource) => (stateResources?.[resource] ?? 0) <= 0);
}
