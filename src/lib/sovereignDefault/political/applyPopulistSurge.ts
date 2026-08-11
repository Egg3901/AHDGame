/**
 * Phase 11b — populist favorability surge on crisis-fire.
 *
 * When a sovereign-debt crisis fires, anti-establishment sentiment rises in
 * the affected country. NPPs whose ideology maps to "populist" or
 * "nationalist" via Phase 10's `deriveIdeology` get a bulk +10 favorability
 * bump. The bump is then gradually eroded by the existing favorability
 * decay each turn (no separate decay system needed — relies on the natural
 * regression-to-mean of the favorability stat over time).
 *
 * Deterministic + idempotent caveats:
 *   - Same crisis-fire turn re-runs would re-apply the bump. crisisDetection
 *     gates this via the `firedThisEvaluation` flag (only fires once per
 *     state transition into crisisPending), so re-runs are bounded.
 */

import type { Db } from "mongodb";
import type { NPP } from "@/lib/db/types/npp";
import type { CountryId } from "@/lib/constants/countries";
import { deriveIdeology } from "@/lib/sovereignDefault/npc/getExecutiveLeaderProfile";

/** Magnitude of the favorability bump applied to qualifying NPPs. */
export const POPULIST_SURGE_FAVORABILITY = 10;

export interface PopulistSurgeResult {
  npcsAffected: number;
}

export async function applyPopulistSurgeOnCrisis(
  db: Db,
  countryCode: CountryId
): Promise<PopulistSurgeResult> {
  const npps = await db
    .collection<NPP>("npps")
    .find({ countryId: countryCode, retiredAt: null })
    .toArray();

  const qualifyingIds = npps
    .filter((n) => {
      const ideology = deriveIdeology(n.policies);
      return ideology === "populist" || ideology === "nationalist";
    })
    .map((n) => n._id);

  if (qualifyingIds.length === 0) return { npcsAffected: 0 };

  await db
    .collection<NPP>("npps")
    .updateMany(
      { _id: { $in: qualifyingIds } },
      { $inc: { favorability: POPULIST_SURGE_FAVORABILITY } }
    );
  return { npcsAffected: qualifyingIds.length };
}
