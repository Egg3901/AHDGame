import { WORLD_COUNTRY_ISO_TO_ID } from "@/lib/worldCountryRegistry";
import {
  getWorldEntityPresetManifest,
  type WorldEntityManifestEntry,
  type WorldEntityStatus,
  type WorldSimulationTier,
} from "./worldEntityManifest";

export interface BackgroundMacroSummary {
  population: number;
  economicSystem: "market" | "planned";
  stability: number;
  tradeExposure: number;
  lastMacroTickTurn: number | null;
  contributionComputedOnTurn: number;
  provenance: "authored-1953" | "estimated-background";
}

export interface WorldEntityMapItem {
  entityId: string;
  countryId?: string;
  displayName: string;
  status: WorldEntityStatus;
  parentEntityId?: string;
  simulationTier: WorldSimulationTier;
  autonomousReady: boolean;
  playerReady: boolean;
  macroSummary?: BackgroundMacroSummary;
}

export interface WorldEntityMapSnapshot {
  presetId: string;
  byFeatureId: Record<string, WorldEntityMapItem>;
  /** Includes entities without map geometry so the inspection picker can reach them. */
  byEntityId?: Record<string, WorldEntityMapItem>;
  unmappedEntityIds: string[];
}

/**
 * Preset-aware map/read model for the world page.
 *
 * The current Natural Earth geometry is modern, so historical countries that
 * have no single modern feature remain explicit in `unmappedEntityIds` rather
 * than disappearing silently. Historical geometry can later attach additional
 * feature IDs without changing the world-entity domain.
 *
 * Tier-3 rows may declare `mapFeatureIds` as modern proxies (#3728).
 */
export function getWorldEntityMapSnapshot(
  presetId: string,
  runtimeEntries?: readonly WorldEntityManifestEntry[]
): WorldEntityMapSnapshot {
  const entries = runtimeEntries ?? getWorldEntityPresetManifest(presetId).entries;
  const featureIdsByCountry = new Map<string, string[]>();
  for (const [featureId, countryId] of Object.entries(WORLD_COUNTRY_ISO_TO_ID)) {
    const featureIds = featureIdsByCountry.get(countryId) ?? [];
    featureIds.push(featureId);
    featureIdsByCountry.set(countryId, featureIds);
  }

  const byFeatureId: Record<string, WorldEntityMapItem> = {};
  const byEntityId: Record<string, WorldEntityMapItem> = {};
  const unmappedEntityIds: string[] = [];

  for (const entry of entries) {
    const fromCountry = entry.countryId ? (featureIdsByCountry.get(entry.countryId) ?? []) : [];
    const featureIds =
      entry.mapFeatureIds && entry.mapFeatureIds.length > 0 ? entry.mapFeatureIds : fromCountry;
    const item: WorldEntityMapItem = {
      entityId: entry.entityId,
      countryId: entry.countryId,
      displayName: entry.displayName,
      status: entry.status,
      parentEntityId: entry.parentEntityId,
      simulationTier: entry.simulationTier,
      autonomousReady: entry.readiness.autonomous === "ready",
      playerReady: entry.readiness.player === "ready",
    };
    byEntityId[entry.entityId] = item;
    if (featureIds.length === 0) {
      unmappedEntityIds.push(entry.entityId);
      continue;
    }
    for (const featureId of featureIds) {
      // A settled sovereign replaces a dependent or emergent grouping on its
      // modern feature. Other overlaps retain first-writer ownership.
      if (
        !byFeatureId[featureId] ||
        (byFeatureId[featureId].status !== "sovereign" && item.status === "sovereign")
      )
        byFeatureId[featureId] = item;
    }
  }

  return {
    presetId,
    byFeatureId,
    byEntityId,
    unmappedEntityIds: unmappedEntityIds.sort(),
  };
}

export { backgroundMacroFeatureIds } from "./worldEntityMapInspection";
