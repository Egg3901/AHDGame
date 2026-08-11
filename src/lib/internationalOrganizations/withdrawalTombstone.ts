import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { InternationalOrganizationId } from "@/lib/constants/internationalOrganizations";
import { getOrganizationWithdrawalsCollection } from "@/lib/db/collections";

/**
 * Withdrawal tombstones. When a country deliberately leaves an organization we
 * record a tombstone so the founding-member self-heal
 * (`ensureFoundingMembershipsAndLeadership` / `seedInternationalOrganizations`)
 * does NOT re-add it on the next page-view reseed or server bootstrap. The
 * tombstone is cleared when the country legitimately re-joins, and the whole
 * collection is wiped on world reset (so a fresh world re-seeds every founder).
 */

/** Stable key for membership-set lookups: `"<orgId> <countryId>"`. */
export function withdrawalKey(organizationId: string, countryId: string): string {
  return `${organizationId} ${countryId}`;
}

/** Record (upsert) a withdrawal tombstone for (organizationId, countryId). */
export async function recordOrganizationWithdrawal(
  db: Db,
  organizationId: InternationalOrganizationId | string,
  countryId: CountryId,
  currentTurn: number,
  now: Date = new Date()
): Promise<void> {
  const col = await getOrganizationWithdrawalsCollection(db);
  await col.updateOne(
    { organizationId, countryId },
    {
      $set: { withdrawnTurn: currentTurn, withdrawnAt: now },
      $setOnInsert: { _id: new ObjectId(), organizationId, countryId },
    },
    { upsert: true }
  );
}

/** Clear a withdrawal tombstone — called when a country (re-)joins the org. */
export async function clearOrganizationWithdrawal(
  db: Db,
  organizationId: InternationalOrganizationId | string,
  countryId: CountryId
): Promise<void> {
  const col = await getOrganizationWithdrawalsCollection(db);
  await col.deleteOne({ organizationId, countryId });
}

/**
 * Load every active withdrawal tombstone as a Set of `withdrawalKey(...)` strings,
 * for batch "did this founder deliberately leave?" checks in the self-heal paths.
 */
export async function loadWithdrawnMemberKeys(db: Db): Promise<Set<string>> {
  const col = await getOrganizationWithdrawalsCollection(db);
  const rows = await col.find({}, { projection: { organizationId: 1, countryId: 1 } }).toArray();
  return new Set(rows.map((r) => withdrawalKey(r.organizationId, r.countryId)));
}
