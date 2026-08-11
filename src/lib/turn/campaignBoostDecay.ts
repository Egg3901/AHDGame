import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { decayBoostMap } from "@/lib/redistricting/campaignBoost";
import type { Election } from "@/lib/db/types";

/**
 * Decay Campaign Here boosts toward 0 each turn. Intentionally flag-agnostic:
 * boosts are only ever *applied* in the flag-gated districted resolver, but they
 * must keep eroding even if the flag is toggled off so they can never freeze and
 * resurface later. Once every boost prunes to 0 the field disappears and the
 * query matches nothing, so the steady-state cost when the feature is unused is nil.
 */
export async function processCampaignBoostDecay(
  currentTurn: number,
  now: Date = new Date(),
  injectedDb?: Db
): Promise<{ electionsDecayed: number }> {
  const db = injectedDb ?? (await getDb());

  const elections = (await db
    .collection<Election>("elections")
    .find({
      electionType: "house",
      status: { $in: ["active", "upcoming"] },
      districtCampaignBoosts: { $exists: true },
    })
    .toArray()) as Election[];

  let decayed = 0;
  for (const e of elections) {
    if (!e.districtCampaignBoosts) continue;
    const next = decayBoostMap(e.districtCampaignBoosts);
    await db
      .collection<Election>("elections")
      .updateOne({ _id: e._id }, { $set: { districtCampaignBoosts: next, updatedAt: now } });
    decayed += 1;
  }
  return { electionsDecayed: decayed };
}
