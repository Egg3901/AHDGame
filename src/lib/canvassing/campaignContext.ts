/**
 * Canvassing respects the rules of the race the player is campaigning in.
 * Standalone canvassing keeps legacy targets while any affected race uses them.
 */
import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Election } from "@/lib/db/types";
import { badRequest } from "@/lib/api/errors";
import { usesCampaignRules } from "@/lib/campaignTargeting/rules";

export async function canUseNativeCanvassTargets(
  db: Db,
  countryId: CountryId,
  stateId: string,
  electionId?: string
): Promise<boolean> {
  const elections = await db
    .collection<Election>("elections")
    .find(
      {
        countryId,
        status: "active",
        state: { $in: [stateId, countryId] },
        ...(electionId ? { _id: new ObjectId(electionId) } : {}),
      },
      { projection: { campaignRulesVersion: 1 } }
    )
    .toArray();
  if (electionId && !elections.length) throw badRequest("Election is not active in this region");
  // Without a specific race, use targets every affected race can count.
  return elections.every(usesCampaignRules);
}
