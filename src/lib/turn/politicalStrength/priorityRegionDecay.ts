import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { PoliticalParty, StatePartyOrg } from "@/lib/db/types";

/**
 * Per-turn validator for `Party.priorityRegion`. Auto-evicts ineligible
 * states from the cluster but does NOT replace them — the cooldown stays
 * in effect until the original 168-turn lockout expires.
 *
 * Per plan §"Phase 3 — Decisions Recorded During Execution" D6:
 *   - lock survives chair turnover (no chairId-based eviction)
 *   - states drop out automatically when ineligible
 *   - slot stays empty until cooldown expires
 *
 * "Ineligible" criteria for a state still in the cluster:
 *   - The state row no longer exists in `statePartyOrg` for this party
 *     (state split / merged / removed from the country's region set)
 *   - The party's `organization` in that state is `0` (lost presence)
 *
 * Future criteria (e.g. "state is uncontested for the party") can be added
 * without changing the wiring; for now keep the rule conservative so we
 * don't auto-evict states the player can still meaningfully prioritize.
 */
export interface PriorityRegionDecayResult {
  partiesScanned: number;
  partiesWithCluster: number;
  statesEvicted: number;
}

export async function processPriorityRegionDecay(
  injectedDb?: Db
): Promise<PriorityRegionDecayResult> {
  const db = injectedDb ?? (await getDb());

  const result: PriorityRegionDecayResult = {
    partiesScanned: 0,
    partiesWithCluster: 0,
    statesEvicted: 0,
  };

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ priorityRegion: { $exists: true } })
    .toArray();
  result.partiesScanned = parties.length;
  if (parties.length === 0) return result;

  for (const party of parties) {
    const cluster = party.priorityRegion;
    if (!cluster) continue;
    if (cluster.stateIds.length === 0) continue;
    result.partiesWithCluster += 1;

    const partyIdString = String(party.sequentialId);
    const rows = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({
        countryId: party.countryId,
        partyId: partyIdString,
        stateId: { $in: cluster.stateIds },
      })
      .toArray();
    const eligible = new Set(rows.filter((r) => (r.organization ?? 0) > 0).map((r) => r.stateId));

    const filtered = cluster.stateIds.filter((id) => eligible.has(id));
    const evicted = cluster.stateIds.length - filtered.length;
    if (evicted === 0) continue;

    result.statesEvicted += evicted;
    await db.collection<PoliticalParty>("politicalParties").updateOne(
      { _id: party._id },
      {
        $set: {
          "priorityRegion.stateIds": filtered,
          updatedAt: new Date(),
        },
      }
    );
  }

  return result;
}
