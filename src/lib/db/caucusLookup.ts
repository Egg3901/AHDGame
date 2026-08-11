import type { Db } from "mongodb";
import type { Caucus, CaucusMembership, CaucusPolicyPosition } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Normalise a chair-authored caucus name into a URL slug. Lowercased, ASCII
 * letters/digits/dashes only, collapsed dashes, trimmed. Empty inputs and
 * inputs that yield an empty slug throw — callers should validate first.
 */
export function normaliseCaucusSlug(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) throw new Error("Caucus slug cannot be empty");
  const slug = trimmed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!slug) throw new Error(`Cannot derive slug from "${input}"`);
  return slug;
}

/**
 * Strip `slug` from the `previousSlugs` array of any OTHER caucus in the same
 * party that still claims it. Call this whenever a slug is being claimed by
 * a new owner (founding a caucus, renaming an existing caucus). The reclaim
 * invariant documented on `Caucus.previousSlugs` requires this so the
 * resolver in `findCaucusBySlug` doesn't accidentally redirect to a stale
 * caucus that no longer owns the slug.
 *
 * Returns the number of documents that were modified.
 */
export async function reclaimSlug(
  db: Db,
  countryId: CountryId,
  partyId: string,
  slug: string,
  newOwnerCaucusId: import("mongodb").ObjectId | null
): Promise<number> {
  const filter: Record<string, unknown> = {
    countryId,
    partyId,
    previousSlugs: slug,
  };
  if (newOwnerCaucusId) {
    filter._id = { $ne: newOwnerCaucusId };
  }
  const result = await db.collection<Caucus>("caucuses").updateMany(filter, {
    $pull: { previousSlugs: slug },
    $set: { updatedAt: new Date() },
  });
  return result.modifiedCount;
}

/**
 * Result of resolving a caucus by slug. When the caller's slug matched a
 * previous (renamed-away) slug, `isRedirect` is true and `caucus.slug` holds the
 * current canonical slug — route handlers should surface that to the client so
 * URLs can be rewritten.
 */
export interface CaucusSlugResolution {
  caucus: Caucus;
  isRedirect: boolean;
}

/**
 * Look up a caucus by its slug (current OR previous) within a (countryId, partyId).
 * Returns null if no caucus claims the slug.
 *
 * Resolution order:
 *   1. Active caucus whose current `slug` matches.
 *   2. Active caucus whose `previousSlugs` array contains the slug — flagged as redirect.
 *
 * If a slug appears in another caucus's `previousSlugs` AND in an active caucus's
 * current `slug`, the current owner always wins. Write paths must wipe a slug
 * from any other caucus's `previousSlugs` whenever a new owner claims it (see
 * `previousSlugs` doc in caucus.ts) — that invariant is what keeps this lookup
 * unambiguous.
 */
export async function findCaucusBySlug(
  db: Db,
  countryId: CountryId,
  partyId: string,
  slug: string
): Promise<CaucusSlugResolution | null> {
  const collection = db.collection<Caucus>("caucuses");

  const current = await collection.findOne({
    countryId,
    partyId,
    slug,
    disbandedAt: null,
  });
  if (current) return { caucus: current, isRedirect: false };

  const renamed = await collection.findOne({
    countryId,
    partyId,
    previousSlugs: slug,
    disbandedAt: null,
  });
  if (renamed) return { caucus: renamed, isRedirect: true };

  return null;
}

/** List all active caucuses belonging to a party, in name order. */
export async function listCaucusesForParty(
  db: Db,
  countryId: CountryId,
  partyId: string
): Promise<Caucus[]> {
  return db
    .collection<Caucus>("caucuses")
    .find({ countryId, partyId, disbandedAt: null })
    .sort({ name: 1 })
    .toArray();
}

/** List policy positions for a caucus, ordered by sortOrder then createdAt. */
export async function listCaucusPositions(
  db: Db,
  caucusId: import("mongodb").ObjectId
): Promise<CaucusPolicyPosition[]> {
  return db
    .collection<CaucusPolicyPosition>("caucusPolicyPositions")
    .find({ caucusId })
    .sort({ sortOrder: 1, createdAt: 1 })
    .toArray();
}

/** List active memberships for a caucus, optionally filtered by member type. */
export async function listCaucusMemberships(
  db: Db,
  caucusId: import("mongodb").ObjectId,
  memberType?: "character" | "npp"
): Promise<CaucusMembership[]> {
  const query: Record<string, unknown> = { caucusId, status: "active" };
  if (memberType) query.memberType = memberType;
  return db
    .collection<CaucusMembership>("caucusMemberships")
    .find(query)
    .sort({ joinedAt: 1 })
    .toArray();
}

/** Count active memberships for a caucus, split by member type. */
export async function countCaucusMembers(
  db: Db,
  caucusId: import("mongodb").ObjectId
): Promise<{ players: number; npps: number; total: number }> {
  const rows = await db
    .collection<CaucusMembership>("caucusMemberships")
    .aggregate<{ _id: "character" | "npp"; count: number }>([
      { $match: { caucusId, status: "active" } },
      { $group: { _id: "$memberType", count: { $sum: 1 } } },
    ])
    .toArray();
  let players = 0;
  let npps = 0;
  for (const row of rows) {
    if (row._id === "character") players = row.count;
    else if (row._id === "npp") npps = row.count;
  }
  return { players, npps, total: players + npps };
}
