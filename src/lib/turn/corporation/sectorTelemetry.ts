import type { CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";
import { trendGrowthRate } from "@/lib/utils/sectorGrowth";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import type { SectorClearingResult } from "@/lib/market/clearing";
import type { InventoryTurnResult } from "@/lib/corporations/sectorInventory";
import { STRANDED_LOW_FILL_THRESHOLD } from "@/lib/corporations/strandedPlant";

export function legacyRevenueShadowTelemetry(input: {
  sector: CorporateSector;
  isFlipTurn: boolean;
  preFlipNameplateRevenue: number;
  brakedTargetRate: number;
  newCurrentGrowthRate: number;
  embargoLegacyMothball: boolean;
  sectorCurrencyCode: CurrencyCode | undefined;
  sectorFxRate: number;
}): Record<string, unknown> {
  const {
    sector,
    isFlipTurn,
    preFlipNameplateRevenue,
    brakedTargetRate,
    newCurrentGrowthRate,
    embargoLegacyMothball,
    sectorCurrencyCode,
    sectorFxRate,
  } = input;
  const prevShadowLocal = sector.legacyRevenueShadow;
  const prevShadow =
    typeof prevShadowLocal === "number" && Number.isFinite(prevShadowLocal) && prevShadowLocal >= 0
      ? readCorpEconomicAnchor(prevShadowLocal, sectorCurrencyCode, sectorFxRate)
      : null;
  const legacyTargetRate =
    !isFlipTurn &&
    typeof sector.legacyTargetGrowthRateShadow === "number" &&
    Number.isFinite(sector.legacyTargetGrowthRateShadow)
      ? sector.legacyTargetGrowthRateShadow
      : brakedTargetRate;
  const legacyCurrentRate =
    !isFlipTurn &&
    typeof sector.legacyGrowthRateShadow === "number" &&
    Number.isFinite(sector.legacyGrowthRateShadow)
      ? trendGrowthRate(sector.legacyGrowthRateShadow, legacyTargetRate)
      : newCurrentGrowthRate;
  const legacyPerTurnRate = embargoLegacyMothball
    ? 0
    : legacyCurrentRate / GROWTH_RATE_TURNS_PER_YEAR;
  const nextShadowAnchor =
    isFlipTurn || prevShadow === null
      ? preFlipNameplateRevenue
      : prevShadow * (1 + legacyPerTurnRate / 100);

  return {
    legacyRevenueShadow: writeCorpEconomicLocal(nextShadowAnchor, sectorCurrencyCode, sectorFxRate),
    legacyGrowthRateShadow: legacyCurrentRate,
    legacyTargetGrowthRateShadow: legacyTargetRate,
  };
}

export function marketTelemetry(input: {
  clearingEnabled: boolean;
  clearing?: SectorClearingResult;
  clearingFactor: number;
  clearingStartTurn?: number | null;
  mothballed: boolean;
  sector: CorporateSector;
  inventoryTurn?: InventoryTurnResult;
}): Record<string, unknown> {
  const {
    clearingEnabled,
    clearing,
    clearingFactor,
    clearingStartTurn,
    mothballed,
    sector,
    inventoryTurn,
  } = input;
  const update: Record<string, unknown> = {};

  if (clearingEnabled && clearing) {
    update.clearingFactor = Math.round(clearingFactor * 1000) / 1000;
    update.soldFraction = Math.round(clearing.soldFraction * 1000) / 1000;
    if (!mothballed) {
      update.lowFillTurns =
        clearing.soldFraction < STRANDED_LOW_FILL_THRESHOLD ? (sector.lowFillTurns ?? 0) + 1 : 0;
    }
    update.soldByCommodity = Object.fromEntries(
      Object.entries(clearing.soldByCommodity ?? {})
        .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
        .map(([commodity, sold]) => [commodity, Math.round(sold * 1000) / 1000])
    );
    update.effectivePosture = Math.round(clearing.effectivePosture * 1000) / 1000;
    update.clearingStartTurn = clearingStartTurn ?? null;
  }

  if (inventoryTurn) {
    update.inventoryUnits = Object.fromEntries(
      Object.entries(inventoryTurn.nextInventory)
        .filter((entry): entry is [string, number] => entry[1] > 0)
        .map(([commodity, held]) => [commodity, Math.round(held * 100) / 100])
    );
    update.inventoryValueAnchor = Math.round(inventoryTurn.heldValueAnchor);
    update.inventoryDrainedUnits = Math.round(inventoryTurn.drainedUnits * 100) / 100;
    update.inventorySpoiledUnits = Math.round(inventoryTurn.spoiledUnits * 100) / 100;
  }

  return update;
}
