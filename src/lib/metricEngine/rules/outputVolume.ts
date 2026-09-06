import type { CorporationType } from "@/lib/constants/corporations";
import { unitYieldForSupply } from "@/lib/constants/capacityEconomy";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";

export interface OutputVolumeSector {
  sectorType: CorporationType;
  producedUnits?: number;
  strategyId?: string;
  transitionFromStrategyId?: string | null;
  transitionStartTurn?: number | null;
}

/**
 * Production valued at the canonical commodity basket, never market prices or
 * FX. The common era unit scale cancels in growth ratios, so use scale 1 for
 * this index. It is a volume index, not money available to spend or tax.
 */
export function constantPriceOutput(sector: OutputVolumeSector, turn: number): number | null {
  const units = sector.producedUnits;
  if (typeof units !== "number" || !Number.isFinite(units) || units < 0) return null;
  const rates = getEffectiveStrategyRates(
    sector.sectorType,
    sector.strategyId ?? "standard",
    sector.transitionFromStrategyId,
    sector.transitionStartTurn,
    turn
  );
  const unitYield = unitYieldForSupply(rates.supply, 1);
  if (!Number.isFinite(unitYield) || unitYield <= 0) return null;
  const output = units / unitYield;
  return Number.isFinite(output) ? output : null;
}

/** A partial observation must never be mistaken for a regional output loss. */
export function sumObservedOutput(sectors: readonly { outputVolume?: number }[]): number | null {
  if (sectors.length === 0) return null;
  let total = 0;
  for (const sector of sectors) {
    const value = sector.outputVolume;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    total += value;
  }
  return Number.isFinite(total) ? total : null;
}
