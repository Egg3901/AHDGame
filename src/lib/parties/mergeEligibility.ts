/**
 * Party mergers require live, same-country geographic contact.
 * assertMergeEligibility checks members, officials and active NPPs before
 * proposal creation and again before any merger transfers.
 */
import type { Db } from "mongodb";
import type { PoliticalParty } from "@/lib/db/types";
import { STATE_ADJACENCY } from "@/lib/constants/stateAdjacency";
import { getPartyPresenceMap } from "./partyFrontier";
import { hasMergeAdjacency } from "./rules/mergeAdjacency";

export class MergeEligibilityError extends Error {}

export async function assertMergeEligibility(
  db: Db,
  source: Pick<PoliticalParty, "_id" | "countryId" | "sequentialId" | "isDefunct">,
  target: Pick<PoliticalParty, "_id" | "countryId" | "sequentialId" | "isDefunct">
): Promise<void> {
  if (
    source._id.equals(target._id) ||
    source.isDefunct ||
    target.isDefunct ||
    source.countryId !== target.countryId
  ) {
    throw new MergeEligibilityError("A merger requires two active parties in the same country.");
  }
  const sourceId = String(source.sequentialId);
  const targetId = String(target.sequentialId);
  const presence = await getPartyPresenceMap(db, source.countryId, [sourceId, targetId]);
  if (
    !hasMergeAdjacency(
      presence.get(sourceId) ?? new Set(),
      presence.get(targetId) ?? new Set(),
      STATE_ADJACENCY[source.countryId] ?? {}
    )
  ) {
    throw new MergeEligibilityError(
      "Parties can only merge when their existing presence overlaps or touches an adjacent region. Presence requires a member, elected official, or active NPP in each party."
    );
  }
}
