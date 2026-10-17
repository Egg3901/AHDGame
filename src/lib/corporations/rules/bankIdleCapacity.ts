/**
 * Bank branch capacity is reserved before other idle causes in the sector meter.
 * bankIdleCapacity caps the charter's reservation to idle capacity left after mothballing.
 */
import type { OperatingSectorType } from "@/lib/constants/corporations";

export function bankIdleCapacity(
  sectorType: OperatingSectorType,
  capacityUnits: number,
  availableIdleUnits: number,
  commodityScale = 1
): { units: number; capacityShare: number } {
  const capacityShare = sectorType === "financial" ? 1 - commodityScale : 0;
  return {
    units: Math.min(availableIdleUnits, capacityUnits * capacityShare),
    capacityShare,
  };
}
