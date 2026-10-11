/**
 * Plant productivity. Technology and the 1991 Energy ramp increase output per
 * unit of capacity; productionProductivityMultiplier gives production and
 * expansion estimates the same current-turn output basis.
 */
import { techOutputUnitsMultiplier } from "@/lib/constants/capacityEconomy";
import type { CommodityType } from "@/lib/constants/commodities";
import { energyProductivityMultiplier } from "./energyProductivityRamp";

export function productionProductivityMultiplier(input: {
  sectorType: string;
  supply?: Partial<Record<CommodityType, number>>;
  outputRateMult?: Record<string, number> | null;
  currentTurn: number;
  preset?: string;
}): number {
  return (
    techOutputUnitsMultiplier(input.supply, input.outputRateMult) *
    energyProductivityMultiplier(input.sectorType, input.currentTurn, input.preset)
  );
}
