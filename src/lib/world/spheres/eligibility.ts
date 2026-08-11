import {
  getWorldEntityPresetManifest,
  isManifestSphereSponsor,
  type WorldEntityId,
} from "@/lib/world/worldEntityManifest";

/**
 * Preset-specific sponsor eligibility (#3718).
 * Reads the manifest matrix — independent of whether the country is currently
 * player- or NPP-controlled.
 */
export function isEligibleSphereSponsor(presetId: string, entityId: WorldEntityId): boolean {
  return isManifestSphereSponsor(presetId, entityId);
}

/** Eligible sponsor ids for a preset (stable sorted order). */
export function listEligibleSphereSponsors(presetId: string): WorldEntityId[] {
  const manifest = getWorldEntityPresetManifest(presetId);
  return manifest.entries
    .filter((entry) => entry.sphere.canSponsor)
    .map((entry) => entry.entityId)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Throws when a non-eligible entity attempts a sponsor action.
 * Control kind (NPP vs player) is irrelevant — only the preset matrix matters.
 */
export function assertEligibleSphereSponsor(presetId: string, entityId: WorldEntityId): void {
  if (!isEligibleSphereSponsor(presetId, entityId)) {
    throw new Error(`Entity ${entityId} is not an eligible sphere sponsor in preset ${presetId}.`);
  }
}
