import type { Db } from "mongodb";
import type { PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Recompute and persist a party's denormalized `memberCount` from live
 * membership: characters affiliated to the party plus active (non-retired)
 * NPPs, scoped to the country. Returns the recomputed total.
 *
 * `memberCount` is a cached field maintained by many `$inc ±1` sites, so it
 * drifts over time. The party list/detail surfaces already derive their counts
 * live and ignore the stored field, but a few gameplay readers trust it — most
 * notably the vacant-chair leadership-election accelerator in
 * `nationalPartyElections`, which skips a party whose stored count is `<= 0`.
 *
 * Bulk party-split paths (charter ratification, one-party-state faction split)
 * move many members at once; blind `$inc` decrements there drove the stored
 * count negative (#0701). Recomputing from the source of truth is authoritative
 * and can never go negative, so the split paths call this instead of guessing.
 *
 * Banned members are stripped from party membership elsewhere
 * (`stripPartyMembershipForBannedUser`), so a straight affiliation count
 * matches the live-derived roster without a separate ban filter.
 */
export async function recomputePartyMemberCount(
  db: Db,
  countryId: CountryId,
  sequentialId: number
): Promise<number> {
  const partyKey = String(sequentialId);
  const [characterCount, nppCount] = await Promise.all([
    db.collection("characters").countDocuments({ party: partyKey, countryId }),
    db.collection("npps").countDocuments({ party: partyKey, countryId, retiredAt: null }),
  ]);
  const memberCount = characterCount + nppCount;
  await db
    .collection<PoliticalParty>("politicalParties")
    .updateOne({ sequentialId, countryId }, { $set: { memberCount, updatedAt: new Date() } });
  return memberCount;
}
