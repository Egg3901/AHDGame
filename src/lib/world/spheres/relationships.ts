import type {
  WorldEntityId,
  WorldEntityManifestEntry,
  WorldEntityRelationship,
} from "@/lib/world/worldEntityManifest";
import type { SphereMembership, SphereRelationship, SphereTreatyState } from "./types";

const TREATY_STATES = new Set<SphereTreatyState>(["none", "proposed", "active", "suspended"]);

function isTreatyState(value: unknown): value is SphereTreatyState {
  return typeof value === "string" && TREATY_STATES.has(value as SphereTreatyState);
}

/**
 * Normalize a manifest relationship into runtime sphere shape.
 * Legacy rows without `treatyState` treat non-empty treatyIds as active.
 */
export function toSphereRelationship(rel: WorldEntityRelationship): SphereRelationship {
  const treatyState: SphereTreatyState = isTreatyState(
    (rel as WorldEntityRelationship & { treatyState?: unknown }).treatyState
  )
    ? (rel as WorldEntityRelationship & { treatyState: SphereTreatyState }).treatyState
    : rel.treatyIds.length > 0
      ? "active"
      : "none";

  return {
    sponsorId: rel.sponsorId,
    alignment: rel.alignment,
    integration: rel.integration,
    treatyIds: [...rel.treatyIds],
    treatyState,
  };
}

export function membershipFromManifestEntry(entry: WorldEntityManifestEntry): SphereMembership {
  const relationships = entry.sphere.relationships.map(toSphereRelationship);
  const primary =
    entry.sphere.primarySphereId ??
    (relationships.length === 1 ? relationships[0]!.sponsorId : null);

  return {
    entityId: entry.entityId,
    presetId: entry.presetId,
    primarySphereId: primary,
    relationships,
  };
}

/**
 * Validate membership invariants used by routing and the manifest.
 * Throws on duplicate sponsors, invalid primary, or out-of-range scores.
 */
export function assertValidSphereMembership(membership: SphereMembership): void {
  const seen = new Set<WorldEntityId>();
  for (const rel of membership.relationships) {
    if (seen.has(rel.sponsorId)) {
      throw new Error(
        `Sphere membership for ${membership.entityId} has duplicate sponsor ${rel.sponsorId}.`
      );
    }
    seen.add(rel.sponsorId);
    if (
      !Number.isFinite(rel.alignment) ||
      rel.alignment < 0 ||
      rel.alignment > 1 ||
      !Number.isFinite(rel.integration) ||
      rel.integration < 0 ||
      rel.integration > 1
    ) {
      throw new Error(
        `Sphere membership for ${membership.entityId} has invalid relationship values.`
      );
    }
    if (!isTreatyState(rel.treatyState)) {
      throw new Error(
        `Sphere membership for ${membership.entityId} has invalid treaty state ${String(rel.treatyState)}.`
      );
    }
  }

  if (membership.primarySphereId != null) {
    if (!seen.has(membership.primarySphereId)) {
      throw new Error(
        `Primary sphere ${membership.primarySphereId} is not among relationships for ${membership.entityId}.`
      );
    }
  } else if (membership.relationships.length > 1) {
    throw new Error(
      `Sphere membership for ${membership.entityId} has multiple relationships but no primarySphereId.`
    );
  }
}

/** Resolve the single primary sponsor, or null when none is designated. */
export function resolvePrimarySponsor(membership: SphereMembership): WorldEntityId | null {
  if (membership.primarySphereId != null) return membership.primarySphereId;
  if (membership.relationships.length === 1) return membership.relationships[0]!.sponsorId;
  return null;
}
