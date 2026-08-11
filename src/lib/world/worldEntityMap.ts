import { WORLD_COUNTRY_ISO_TO_ID } from "@/lib/worldCountryRegistry";
import {
  getWorldEntityPresetManifest,
  type WorldEntityStatus,
  type WorldSimulationTier,
} from "./worldEntityManifest";

export interface WorldEntityMapItem {
  entityId: string;
  countryId?: string;
  displayName: string;
  status: WorldEntityStatus;
  parentEntityId?: string;
  simulationTier: WorldSimulationTier;
  autonomousReady: boolean;
  playerReady: boolean;
}

export interface WorldEntityMapSnapshot {
  presetId: string;
  byFeatureId: Record<string, WorldEntityMapItem>;
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
export function getWorldEntityMapSnapshot(presetId: string): WorldEntityMapSnapshot {
  const manifest = getWorldEntityPresetManifest(presetId);
  const featureIdsByCountry = new Map<string, string[]>();
  for (const [featureId, countryId] of Object.entries(WORLD_COUNTRY_ISO_TO_ID)) {
    const featureIds = featureIdsByCountry.get(countryId) ?? [];
    featureIds.push(featureId);
    featureIdsByCountry.set(countryId, featureIds);
  }

  const byFeatureId: Record<string, WorldEntityMapItem> = {};
  const unmappedEntityIds: string[] = [];

  for (const entry of manifest.entries) {
    const fromCountry = entry.countryId ? (featureIdsByCountry.get(entry.countryId) ?? []) : [];
    const featureIds =
      entry.mapFeatureIds && entry.mapFeatureIds.length > 0 ? entry.mapFeatureIds : fromCountry;
    if (featureIds.length === 0) {
      unmappedEntityIds.push(entry.entityId);
      continue;
    }
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
    for (const featureId of featureIds) {
      // First writer wins when multiple entities claim the same modern proxy
      // (e.g. North Vietnam + modern Vietnam feature). Later claimants stay
      // classified in the manifest and appear in diagnostics if needed.
      if (!byFeatureId[featureId]) byFeatureId[featureId] = item;
    }
  }

  return {
    presetId,
    byFeatureId,
    unmappedEntityIds: unmappedEntityIds.sort(),
  };
}
