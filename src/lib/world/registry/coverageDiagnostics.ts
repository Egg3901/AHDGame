import {
  getWorldEntityPresetManifest,
  type WorldEntityId,
  type WorldEntityManifestEntry,
  type WorldEntityRegion,
} from "@/lib/world/worldEntityManifest";
import { getWorldEntityMapSnapshot } from "@/lib/world/worldEntityMap";
import { ALL_EXPECTED_1953_ENTITY_IDS, EXPECTED_1953_ENTITIES_BY_REGION } from "./checklist1953";
import { FORBIDDEN_1953_DISPLAY_NAMES, FORBIDDEN_NAME_ALLOWLIST_IDS } from "./modernNameBanlist";

export interface WorldCoverageDiagnostics {
  presetId: string;
  totalEntries: number;
  byRegion: Record<WorldEntityRegion, number>;
  byTier: Record<string, number>;
  missingFromManifest: WorldEntityId[];
  unexpectedExtras: WorldEntityId[];
  duplicateChecklistIds: WorldEntityId[];
  misParented: Array<{ entityId: WorldEntityId; reason: string }>;
  missingRecognition: WorldEntityId[];
  missingUn: WorldEntityId[];
  modernNameViolations: Array<{ entityId: WorldEntityId; displayName: string }>;
  unmappedEntityIds: WorldEntityId[];
}

function countByRegion(
  entries: readonly WorldEntityManifestEntry[]
): Record<WorldEntityRegion, number> {
  const counts: Record<WorldEntityRegion, number> = {
    europe: 0,
    americas: 0,
    africa: 0,
    asia: 0,
    pacific: 0,
  };
  for (const entry of entries) {
    if (entry.region) counts[entry.region] += 1;
  }
  return counts;
}

function countByTier(entries: readonly WorldEntityManifestEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    counts[entry.simulationTier] = (counts[entry.simulationTier] ?? 0) + 1;
  }
  return counts;
}

function findDuplicateChecklistIds(): WorldEntityId[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ALL_EXPECTED_1953_ENTITY_IDS) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes].sort();
}

/**
 * Coverage diagnostics for the 1953 Tier-3 registry gate.
 * Surfaces omissions, duplicates, mis-parented dependencies, and modern names.
 */
export function getWorldCoverageDiagnostics(presetId = "1953-default"): WorldCoverageDiagnostics {
  const manifest = getWorldEntityPresetManifest(presetId);
  const byId = new Map(manifest.entries.map((e) => [e.entityId, e]));
  const manifestIds = new Set(byId.keys());
  const expected = new Set(ALL_EXPECTED_1953_ENTITY_IDS);

  const missingFromManifest = ALL_EXPECTED_1953_ENTITY_IDS.filter((id) => !manifestIds.has(id));
  const unexpectedExtras = [...manifestIds].filter((id) => !expected.has(id)).sort();

  const misParented: WorldCoverageDiagnostics["misParented"] = [];
  const missingRecognition: WorldEntityId[] = [];
  const missingUn: WorldEntityId[] = [];
  const modernNameViolations: WorldCoverageDiagnostics["modernNameViolations"] = [];
  const forbiddenLower = new Set(FORBIDDEN_1953_DISPLAY_NAMES.map((n) => n.toLowerCase()));

  for (const entry of manifest.entries) {
    if (entry.status === "dependent") {
      if (!entry.parentEntityId && !entry.exceptionalStatus) {
        misParented.push({
          entityId: entry.entityId,
          reason: "dependent without parent or exceptional status",
        });
      } else if (entry.parentEntityId && !byId.has(entry.parentEntityId)) {
        misParented.push({
          entityId: entry.entityId,
          reason: `parent ${entry.parentEntityId} not in manifest`,
        });
      } else if (entry.parentEntityId === entry.entityId) {
        misParented.push({ entityId: entry.entityId, reason: "self-parented" });
      }
    }
    if (!entry.recognition) missingRecognition.push(entry.entityId);
    if (!entry.un) missingUn.push(entry.entityId);
    if (
      !FORBIDDEN_NAME_ALLOWLIST_IDS.has(entry.entityId) &&
      forbiddenLower.has(entry.displayName.toLowerCase())
    ) {
      modernNameViolations.push({
        entityId: entry.entityId,
        displayName: entry.displayName,
      });
    }
  }

  // GH may use "Ghana"; GC must not.
  const goldCoast = byId.get("GC");
  if (goldCoast && /ghana/i.test(goldCoast.displayName)) {
    modernNameViolations.push({ entityId: "GC", displayName: goldCoast.displayName });
  }

  const mapSnapshot = getWorldEntityMapSnapshot(presetId);

  return {
    presetId,
    totalEntries: manifest.entries.length,
    byRegion: countByRegion(manifest.entries),
    byTier: countByTier(manifest.entries),
    missingFromManifest,
    unexpectedExtras,
    duplicateChecklistIds: findDuplicateChecklistIds(),
    misParented,
    missingRecognition,
    missingUn,
    modernNameViolations,
    unmappedEntityIds: mapSnapshot.unmappedEntityIds,
  };
}

export function assert1953CoverageComplete(presetId = "1953-default"): void {
  const d = getWorldCoverageDiagnostics(presetId);
  if (d.duplicateChecklistIds.length > 0) {
    throw new Error(`Duplicate checklist IDs: ${d.duplicateChecklistIds.join(", ")}`);
  }
  if (d.missingFromManifest.length > 0) {
    throw new Error(`Unclassified 1953 entities: ${d.missingFromManifest.join(", ")}`);
  }
  if (d.misParented.length > 0) {
    throw new Error(
      `Mis-parented entities: ${d.misParented.map((m) => `${m.entityId} (${m.reason})`).join("; ")}`
    );
  }
  if (d.modernNameViolations.length > 0) {
    throw new Error(
      `Modern-name fallbacks: ${d.modernNameViolations
        .map((v) => `${v.entityId}=${v.displayName}`)
        .join(", ")}`
    );
  }
  if (d.missingRecognition.length > 0) {
    throw new Error(`Missing recognition: ${d.missingRecognition.join(", ")}`);
  }
  if (d.missingUn.length > 0) {
    throw new Error(`Missing UN lifecycle: ${d.missingUn.join(", ")}`);
  }
}

export function listExpectedEntitiesForRegion(region: WorldEntityRegion): readonly WorldEntityId[] {
  return EXPECTED_1953_ENTITIES_BY_REGION[region];
}
