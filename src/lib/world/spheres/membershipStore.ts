import type { Db } from "mongodb";
import type { SphereMembership } from "./types";
import { assertValidSphereMembership, membershipFromManifestEntry } from "./relationships";
import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";

export const SPHERE_MEMBERSHIPS_COLLECTION = "sphereMemberships";

export interface PersistedSphereMembership extends SphereMembership {
  _id: string;
  lastSponsorTickTurn: number | null;
  updatedAt: Date;
}

/**
 * Load live sphere membership, falling back to the preset manifest seed.
 */
export async function loadSphereMembership(
  db: Db,
  presetId: string,
  entityId: string
): Promise<SphereMembership> {
  const doc = await db
    .collection<PersistedSphereMembership>(SPHERE_MEMBERSHIPS_COLLECTION)
    .findOne({ _id: entityId, presetId });
  if (doc) {
    const membership: SphereMembership = {
      entityId: doc.entityId,
      presetId: doc.presetId,
      primarySphereId: doc.primarySphereId,
      relationships: doc.relationships,
    };
    assertValidSphereMembership(membership);
    return membership;
  }

  const entry = getWorldEntityOrThrow(presetId, entityId);
  const membership = membershipFromManifestEntry(entry);
  assertValidSphereMembership(membership);
  return membership;
}

export async function saveSphereMembership(
  db: Db,
  membership: SphereMembership,
  turn: number | null
): Promise<void> {
  assertValidSphereMembership(membership);
  const now = new Date();
  await db.collection<PersistedSphereMembership>(SPHERE_MEMBERSHIPS_COLLECTION).updateOne(
    { _id: membership.entityId },
    {
      $set: {
        _id: membership.entityId,
        entityId: membership.entityId,
        presetId: membership.presetId,
        primarySphereId: membership.primarySphereId,
        relationships: membership.relationships,
        lastSponsorTickTurn: turn,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}

/**
 * Ensure a membership document exists (seeded from the manifest when absent).
 */
export async function ensureSphereMembership(
  db: Db,
  presetId: string,
  entityId: string
): Promise<SphereMembership> {
  const existing = await db
    .collection<PersistedSphereMembership>(SPHERE_MEMBERSHIPS_COLLECTION)
    .findOne({ _id: entityId });
  if (existing && existing.presetId === presetId) {
    return {
      entityId: existing.entityId,
      presetId: existing.presetId,
      primarySphereId: existing.primarySphereId,
      relationships: existing.relationships,
    };
  }
  const membership = await loadSphereMembership(db, presetId, entityId);
  await saveSphereMembership(db, membership, null);
  return membership;
}
