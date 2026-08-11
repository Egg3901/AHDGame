import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PartyGroupFavorability } from "@/lib/db/types";

/**
 * Load active per-party demographic favorability rows for a country and
 * return them keyed as `${partyId}:${groupId}` → favorabilityDelta, ready
 * to drop into `DistributeVotesOptions.partyGroupFavorabilityByKey`.
 *
 * Filters by `expiresAtTurn > currentTurn` so naturally-expired rows are
 * skipped without needing a write-side expiry phase.
 *
 * Multiple addresses targeting the same (party, group) stack additively —
 * deltas sum, no clamp here (electionVoteDistribution treats them as
 * percentage points on the appeal multiplier so very-high stacks naturally
 * see diminishing returns relative to other multipliers).
 */
export async function loadPartyGroupFavorability(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<Map<string, number>> {
  const rows = await db
    .collection<PartyGroupFavorability>("partyGroupFavorability")
    .find({
      countryId,
      expiresAtTurn: { $gt: currentTurn },
      expired: { $ne: true },
    })
    .project<{ partyId: string; groupId: string; favorabilityDelta: number }>({
      partyId: 1,
      groupId: 1,
      favorabilityDelta: 1,
    })
    .toArray();
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.partyId}:${r.groupId}`;
    map.set(key, (map.get(key) ?? 0) + r.favorabilityDelta);
  }
  return map;
}
