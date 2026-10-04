/**
 * Product lines allocate a share of each owned plant. Shares cannot exceed one
 * or repeat a plant: see validateProductAllocations.
 */
export interface ProductPlantAllocation {
  sectorId: string;
  share: number;
}

/** True when no plant is allocated above its physical capacity share. */
export function validateProductAllocations(
  allocations: readonly ProductPlantAllocation[]
): boolean {
  const shareBySector = new Map<string, number>();
  for (const allocation of allocations) {
    if (!allocation.sectorId || !Number.isFinite(allocation.share) || allocation.share < 0) {
      return false;
    }
    if (shareBySector.has(allocation.sectorId)) return false;
    if (allocation.share > 1) return false;
    shareBySector.set(allocation.sectorId, allocation.share);
  }
  return true;
}
