import {
  DIVERSIFIED_MEDIA_STRATEGY,
  MEDIA_ENTERTAINMENT_SECTOR_TYPE,
  canonicalMediaStrategyForLegacy,
  isLegacyMediaSectorType,
  unionInferredOperatingModels,
  type CanonicalMediaStrategy,
  type MediaSectorTypeInput,
} from "./rules";
import type { MediaOperatingModel } from "@/lib/products/types";

/**
 * Collision merge planner (issue #2234), pure rules.
 *
 * When one corporation owns both legacy sector rows in the same state, the
 * rows merge into one canonical row. The plan conserves economics and
 * names the rescale legs; the `migrate.ts` shell applies them with
 * `capacityRescaleRatio` (survivor and incoming both retool onto the
 * diversified recipe) and folds plant state with `mergeSectorPlantFields`.
 *
 * Deliberate rework: stored money, paid plant basis, capital, inventory,
 * queues, labor/revenue basis, and union linkage are conserved, but the two
 * separate recipes are not — per-turn outputs change by design, so legacy
 * commodity supply equivalence is not owed.
 */

/** Minimal sector-row shape the planner reads. Real docs narrow onto this. */
export interface MediaMergeRow {
  id: string;
  /** Same-state grouping key (stateId). Country is fixed per group. */
  stateId: string;
  corporationId: string;
  sectorType: MediaSectorTypeInput | string;
  strategyId?: string | null;
  revenue: number;
  workers: number;
  profitMargin: number;
  productionPolicyLevel?: number | null;
  negativeProductionSustainedTurns?: number | null;
  /** Sort key for the survivor: earliest row wins, like duplicate-row heals. */
  createdAtMs?: number | null;
  inventoryUnits?: Partial<Record<string, number>> | null;
  inventoryValueAnchor?: number | null;
  inventoryDrainedUnits?: number | null;
  inventorySpoiledUnits?: number | null;
  realizedRevenue?: number | null;
  producedUnits?: number | null;
  soldUnits?: number | null;
  contractAchievableUnits?: number | null;
}

/** One row's retool leg onto the merged recipe. */
export interface MediaMergeRescaleLeg {
  rowId: string;
  fromStrategy: CanonicalMediaStrategy;
  toStrategy: CanonicalMediaStrategy;
}

export interface MediaMergePlan {
  corporationId: string;
  stateId: string;
  survivorId: string;
  loserIds: string[];
  /** Legacy labels consumed by this merge (audit trail, never persisted). */
  legacyTypes: string[];
  sectorType: typeof MEDIA_ENTERTAINMENT_SECTOR_TYPE;
  strategyId: CanonicalMediaStrategy;
  rescaleLegs: MediaMergeRescaleLeg[];
  revenue: number;
  workers: number;
  profitMargin: number;
  productionPolicyLevel: number;
  negativeProductionSustainedTurns: number;
  inventoryUnits: Partial<Record<string, number>>;
  inventoryValueAnchor: number;
  inventoryDrainedUnits: number;
  inventorySpoiledUnits: number;
  realizedRevenue: number;
  producedUnits: number;
  soldUnits: number;
  contractAchievableUnits: number;
  operatingModels: MediaOperatingModel[];
}

const finite = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

function mergeInventoryUnits(rows: readonly MediaMergeRow[]): Partial<Record<string, number>> {
  const out: Partial<Record<string, number>> = {};
  for (const row of rows) {
    for (const [commodity, units] of Object.entries(row.inventoryUnits ?? {})) {
      if (typeof units !== "number" || !Number.isFinite(units) || units === 0) continue;
      out[commodity] = (out[commodity] ?? 0) + units;
    }
  }
  return out;
}

/**
 * Plan the merge of one same-corporation, same-state group of legacy media
 * rows into a single canonical row. Groups with fewer than two legacy rows
 * return null (nothing to merge; the caller still canonicalizes each row's
 * type and strategy id in place). The survivor is the earliest-created row;
 * union linkage stays on the survivor because the shell never touches it.
 */
export function planMediaSectorMerge(rows: readonly MediaMergeRow[]): MediaMergePlan | null {
  const legacy = rows.filter((row) => isLegacyMediaSectorType(row.sectorType));
  if (legacy.length < 2) return null;
  const ordered = [...legacy].sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
  const [survivor, ...losers] = ordered;
  const totalRevenue = legacy.reduce((sum, row) => sum + finite(row.revenue), 0);
  const weighted = (pick: (row: MediaMergeRow) => number): number => {
    if (totalRevenue <= 0) return pick(survivor);
    return legacy.reduce((sum, row) => sum + pick(row) * finite(row.revenue), 0) / totalRevenue;
  };
  const canonicalStrategies = legacy.map((row) =>
    canonicalMediaStrategyForLegacy(row.strategyId)
  );
  return {
    corporationId: survivor.corporationId,
    stateId: survivor.stateId,
    survivorId: survivor.id,
    loserIds: losers.map((row) => row.id),
    legacyTypes: [...new Set(legacy.map((row) => row.sectorType))],
    sectorType: MEDIA_ENTERTAINMENT_SECTOR_TYPE,
    strategyId: DIVERSIFIED_MEDIA_STRATEGY,
    rescaleLegs: legacy.map((row, index) => ({
      rowId: row.id,
      fromStrategy: canonicalStrategies[index],
      toStrategy: DIVERSIFIED_MEDIA_STRATEGY,
    })),
    revenue: totalRevenue,
    workers: legacy.reduce((sum, row) => sum + finite(row.workers), 0),
    profitMargin: weighted((row) => finite(row.profitMargin)),
    productionPolicyLevel: Math.round(weighted((row) => finite(row.productionPolicyLevel))),
    negativeProductionSustainedTurns: Math.round(
      weighted((row) => finite(row.negativeProductionSustainedTurns))
    ),
    inventoryUnits: mergeInventoryUnits(legacy),
    inventoryValueAnchor: legacy.reduce((sum, row) => sum + finite(row.inventoryValueAnchor), 0),
    inventoryDrainedUnits: legacy.reduce((sum, row) => sum + finite(row.inventoryDrainedUnits), 0),
    inventorySpoiledUnits: legacy.reduce((sum, row) => sum + finite(row.inventorySpoiledUnits), 0),
    realizedRevenue: legacy.reduce((sum, row) => sum + finite(row.realizedRevenue), 0),
    producedUnits: legacy.reduce((sum, row) => sum + finite(row.producedUnits), 0),
    soldUnits: legacy.reduce((sum, row) => sum + finite(row.soldUnits), 0),
    contractAchievableUnits: legacy.reduce(
      (sum, row) => sum + finite(row.contractAchievableUnits),
      0
    ),
    operatingModels: unionInferredOperatingModels(legacy.map((row) => row.sectorType)),
  };
}

/** Minimal unowned-sector row shape the planner reads. */
export interface MediaUnownedRow {
  id: string;
  stateId: string;
  countryId: string;
  sectorType: MediaSectorTypeInput | string;
  revenue: number;
  createdAtMs?: number | null;
}

export interface MediaUnownedMergePlan {
  stateId: string;
  countryId: string;
  survivorId: string;
  loserIds: string[];
  sectorType: typeof MEDIA_ENTERTAINMENT_SECTOR_TYPE;
  revenue: number;
}

/**
 * Plan merges for unowned legacy rows sharing a state. Unowned rows carry
 * no strategy, plant, or labor legs, so the merge conserves the one thing
 * they own: demand-side revenue. Returns one plan per colliding group.
 */
export function planMediaUnownedMerges(rows: readonly MediaUnownedRow[]): MediaUnownedMergePlan[] {
  const groups = new Map<string, MediaUnownedRow[]>();
  for (const row of rows) {
    if (!isLegacyMediaSectorType(row.sectorType)) continue;
    const key = `${row.countryId}::${row.stateId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const plans: MediaUnownedMergePlan[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [survivor, ...losers] = [...group].sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
    plans.push({
      stateId: survivor.stateId,
      countryId: survivor.countryId,
      survivorId: survivor.id,
      loserIds: losers.map((row) => row.id),
      sectorType: MEDIA_ENTERTAINMENT_SECTOR_TYPE,
      revenue: group.reduce((sum, row) => sum + finite(row.revenue), 0),
    });
  }
  return plans;
}
