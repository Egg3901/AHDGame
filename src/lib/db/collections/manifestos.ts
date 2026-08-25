import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Manifesto, Pledge } from "@/lib/db/types/manifesto";
import { MANIFESTO_PLEDGE_COUNT } from "@/lib/db/types/manifesto";

/**
 * Persistence for UK manifestos (epic #856, ticket #857).
 * Collection: "manifestos" — one document per party per election.
 *
 * A manifesto is created/edited as a DRAFT (lockedAt: null) by the party leader,
 * then LOCKED at election call. Locking is validated: exactly
 * MANIFESTO_PLEDGE_COUNT pledges, all referencing valid catalog entries, no dupes.
 */

export function getManifestosCollection(db: Db) {
  return db.collection<Manifesto>("manifestos");
}

export interface ManifestoValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Pure validation of a set of pledges against the set of valid catalog ids.
 * Country-agnostic: the caller supplies the valid ids (e.g. from the UK catalog).
 */
export function validateManifestoPledges(
  pledges: Pledge[],
  validCatalogIds: Set<string>
): ManifestoValidationResult {
  if (pledges.length !== MANIFESTO_PLEDGE_COUNT) {
    return { ok: false, error: `manifesto must have exactly ${MANIFESTO_PLEDGE_COUNT} pledges` };
  }
  const seen = new Set<string>();
  for (const p of pledges) {
    if (!validCatalogIds.has(p.catalogEntryId)) {
      return { ok: false, error: `unknown pledge: ${p.catalogEntryId}` };
    }
    if (seen.has(p.catalogEntryId)) {
      return { ok: false, error: `duplicate pledge: ${p.catalogEntryId}` };
    }
    seen.add(p.catalogEntryId);
  }
  return { ok: true };
}

export interface UpsertManifestoDraftInput {
  countryId: CountryId;
  electionId: ObjectId;
  party: string;
  pledges: Pledge[];
  authorCharacterId: ObjectId | null;
  isNPP?: boolean;
  now: Date;
}

/**
 * Create or update a party's DRAFT manifesto for an election. Refuses to touch a
 * manifesto that is already locked (immutable through the campaign).
 * Returns false if the manifesto is locked; true on write.
 */
export async function upsertManifestoDraft(
  db: Db,
  input: UpsertManifestoDraftInput
): Promise<boolean> {
  const col = getManifestosCollection(db);
  const filter = {
    countryId: input.countryId,
    electionId: input.electionId,
    party: input.party,
  };
  const existing = await col.findOne(filter);
  if (existing?.lockedAt) return false;

  await col.updateOne(
    filter,
    {
      $set: {
        pledges: input.pledges,
        authorCharacterId: input.authorCharacterId,
        isNPP: input.isNPP ?? false,
        updatedAt: input.now,
      },
      $setOnInsert: {
        countryId: input.countryId,
        electionId: input.electionId,
        party: input.party,
        lockedAt: null,
        createdAt: input.now,
      },
    },
    { upsert: true }
  );
  return true;
}

/**
 * Lock a party's manifesto at election call. Validates the pledges first.
 * Idempotent: re-locking an already-locked manifesto is a no-op success.
 */
export async function lockManifesto(
  db: Db,
  args: {
    countryId: CountryId;
    electionId: ObjectId;
    party: string;
    validCatalogIds: Set<string>;
    now: Date;
  }
): Promise<ManifestoValidationResult> {
  const col = getManifestosCollection(db);
  const filter = { countryId: args.countryId, electionId: args.electionId, party: args.party };
  const existing = await col.findOne(filter);
  if (!existing) return { ok: false, error: "no manifesto to lock" };
  if (existing.lockedAt) return { ok: true };

  const validation = validateManifestoPledges(existing.pledges, args.validCatalogIds);
  if (!validation.ok) return validation;

  await col.updateOne(filter, { $set: { lockedAt: args.now, updatedAt: args.now } });
  return { ok: true };
}

export async function getManifesto(
  db: Db,
  countryId: CountryId,
  electionId: ObjectId,
  party: string
): Promise<Manifesto | null> {
  return getManifestosCollection(db).findOne({ countryId, electionId, party });
}

export async function listManifestosForElection(
  db: Db,
  countryId: CountryId,
  electionId: ObjectId
): Promise<Manifesto[]> {
  return getManifestosCollection(db).find({ countryId, electionId }).toArray();
}
