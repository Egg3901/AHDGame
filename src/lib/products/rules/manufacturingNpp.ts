import type { CommodityType } from "@/lib/constants/commodities";
import type { ProductPlantAllocation } from "./manufacturingEligibility";

export interface NppManufacturingProductCandidate {
  kindId: string;
  outputCommodity: CommodityType;
  allocations: ProductPlantAllocation[];
  capacityStock: number;
  capacityWeightedMarginPct: number;
  scarcityPriceRatio: number;
  /** Current strategy's legacy value-weighted share for this commodity. */
  supplyMixWeight: number;
}

/** Picks the highest-margin scarce product and resolves ties by stable catalog id. */
export function chooseNppManufacturingProduct<T extends NppManufacturingProductCandidate>(
  candidates: readonly T[]
): T | null {
  return (
    candidates
      .filter(
        (candidate) =>
          candidate.allocations.length > 0 &&
          Number.isFinite(candidate.capacityStock) &&
          candidate.capacityStock > 0 &&
          Number.isFinite(candidate.capacityWeightedMarginPct) &&
          candidate.capacityWeightedMarginPct > 0 &&
          Number.isFinite(candidate.scarcityPriceRatio) &&
          candidate.scarcityPriceRatio > 1 &&
          Number.isFinite(candidate.supplyMixWeight) &&
          candidate.supplyMixWeight > 0
      )
      .map((candidate) => ({
        candidate,
        score:
          candidate.capacityWeightedMarginPct *
          (candidate.scarcityPriceRatio - 1) *
          candidate.supplyMixWeight,
      }))
      .sort((a, b) => b.score - a.score || a.candidate.kindId.localeCompare(b.candidate.kindId))[0]
      ?.candidate ?? null
  );
}
