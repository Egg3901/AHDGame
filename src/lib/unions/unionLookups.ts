import type { Db } from "mongodb";
import type { Union } from "@/lib/db/types";

/** Composite key for `LabourContext.ownedUnionMembershipPressureByKey` and the per-turn owned-unions map. */
export function unionLookupKey(countryId: string, sectorType: string): string {
  return `${countryId}|${sectorType}`;
}

/**
 * v3 Phase 8: fetch every OWNED union's `membershipPressure`, keyed by
 * (countryId, sectorType), for threading into `LabourContext`. Unowned
 * unions are excluded — Phase 5's NPC drift is unaffected for their sectors.
 * A dedicated query (not folded into `buildCorporationLookups`) mirrors how
 * `LabourContext` itself is built as its own per-turn object in
 * `src/lib/turn/corporation/index.ts`, rather than growing the already-large
 * `CorporationLookups`.
 */
export async function buildOwnedUnionMembershipPressureByKey(db: Db): Promise<Map<string, number>> {
  const owned = await db
    .collection<Union>("unions")
    .find(
      { ownerId: { $ne: null } },
      { projection: { countryId: 1, sectorType: 1, membershipPressure: 1 } }
    )
    .toArray();
  const out = new Map<string, number>();
  for (const u of owned) {
    out.set(unionLookupKey(u.countryId, u.sectorType), u.membershipPressure ?? 0);
  }
  return out;
}
