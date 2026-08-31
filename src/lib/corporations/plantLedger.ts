import type { CorporationType } from "@/lib/constants/corporations";
import { plantSizeUnits } from "@/lib/constants/facilityQuantum";

export interface PlantLedgerState {
  plantCount: number;
  plantUnitRemainder: number;
}

interface PlantLedgerSector {
  sectorType: CorporationType;
  plantCount?: number | null;
  plantUnitRemainder?: number | null;
}

function finiteNonNegative(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function wholeNonNegative(value: number | null | undefined): number {
  return Math.floor(finiteNonNegative(value));
}

/**
 * Seed the whole-plant ledger without changing productive capacity.
 *
 * This intentionally matches the existing player-facing facility count:
 * floor capacity by the sector facility quantum, with one small plant for any
 * positive holding below a full quantum. The remainder is construction credit
 * toward the next whole plant and never participates in PvP by itself.
 */
export function seedPlantLedger(
  sectorType: CorporationType,
  capitalStock: number | null | undefined
): PlantLedgerState {
  const stock = finiteNonNegative(capitalStock);
  if (stock <= 0) return { plantCount: 0, plantUnitRemainder: 0 };

  const quantum = plantSizeUnits(sectorType);
  if (stock < quantum) return { plantCount: 1, plantUnitRemainder: 0 };

  const plantCount = Math.floor(stock / quantum);
  return {
    plantCount,
    plantUnitRemainder: stock - plantCount * quantum,
  };
}

/**
 * Add newly delivered construction to a persisted whole-plant ledger.
 * Depreciation does not call this function: it changes plant condition and
 * productive capacity, not the number of owned facilities.
 */
export function advancePlantLedger(input: {
  sectorType: CorporationType;
  plantCount: number | null | undefined;
  plantUnitRemainder: number | null | undefined;
  currentCapitalStock: number | null | undefined;
  deliveredUnits: number;
}): PlantLedgerState {
  const seeded = Number.isInteger(input.plantCount)
    ? {
        plantCount: wholeNonNegative(input.plantCount),
        plantUnitRemainder: finiteNonNegative(input.plantUnitRemainder),
      }
    : seedPlantLedger(input.sectorType, input.currentCapitalStock);
  const quantum = plantSizeUnits(input.sectorType);
  const accumulated = seeded.plantUnitRemainder + finiteNonNegative(input.deliveredUnits);
  const completedPlants = Math.floor(accumulated / quantum);

  return {
    plantCount: seeded.plantCount + completedPlants,
    plantUnitRemainder: accumulated - completedPlants * quantum,
  };
}

/** Adapt a persisted sector row to the construction-ledger calculation. */
export function advanceSectorPlantLedger(
  sector: PlantLedgerSector,
  currentCapitalStock: number,
  deliveredUnits: number
): PlantLedgerState {
  return advancePlantLedger({
    sectorType: sector.sectorType,
    plantCount: sector.plantCount,
    plantUnitRemainder: sector.plantUnitRemainder,
    currentCapitalStock,
    deliveredUnits,
  });
}

/** Allocate a carve to whole plants while conserving the exact opening count. */
export function splitWholePlantCount(
  plantCount: number | null | undefined,
  carvedFraction: number
): { carved: number; kept: number } {
  const total = wholeNonNegative(plantCount);
  const fraction = Number.isFinite(carvedFraction) ? Math.max(0, Math.min(1, carvedFraction)) : 0;
  if (fraction <= 0 || total === 0) return { carved: 0, kept: total };
  if (fraction >= 1) return { carved: total, kept: 0 };

  const carved = Math.min(total, Math.max(1, Math.floor(total * fraction)));
  return { carved, kept: total - carved };
}
