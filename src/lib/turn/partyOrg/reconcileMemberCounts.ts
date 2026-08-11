import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

export interface ReconcileMemberCountsResult {
  partiesChecked: number;
  partiesUpdated: number;
}

interface PartyGroupCount {
  _id: { party: string; countryId: string };
  count: number;
}

/**
 * Per-turn reconciliation of the denormalized `politicalParties.memberCount`
 * cache against live membership: players (characters) + active (non-retired)
 * NPPs, per party.
 *
 * `memberCount` is maintained ad-hoc by many `$inc ±1` sites and isn't touched
 * at all when NPPs retire or churn, so it drifts (and has gone negative). The
 * list/detail surfaces and party-history snapshot already derive their counts
 * live, but the wiki, registration, and coalition roster totals read the stored
 * field — this keeps it exact without manual heals.
 *
 * Two grouped aggregations + a single bulkWrite (only the parties that actually
 * drifted are rewritten), so the cost is independent of player count.
 */
export async function reconcilePartyMemberCounts(db: Db): Promise<ReconcileMemberCountsResult> {
  const [playerGroups, nppGroups, parties] = await Promise.all([
    db
      .collection("characters")
      .aggregate<PartyGroupCount>([
        { $group: { _id: { party: "$party", countryId: "$countryId" }, count: { $sum: 1 } } },
      ])
      .toArray(),
    db
      .collection("npps")
      .aggregate<PartyGroupCount>([
        { $match: { retiredAt: null } },
        { $group: { _id: { party: "$party", countryId: "$countryId" }, count: { $sum: 1 } } },
      ])
      .toArray(),
    db
      .collection<PoliticalParty>("politicalParties")
      .find({})
      .project<{ sequentialId: number; countryId: CountryId; memberCount: number }>({
        sequentialId: 1,
        countryId: 1,
        memberCount: 1,
      })
      .toArray(),
  ]);

  const key = (party: string, countryId: string) => `${countryId}:${party}`;
  const liveCount = new Map<string, number>();
  for (const g of [...playerGroups, ...nppGroups]) {
    if (!g._id) continue;
    const k = key(g._id.party, g._id.countryId);
    liveCount.set(k, (liveCount.get(k) ?? 0) + g.count);
  }

  const now = new Date();
  const ops: AnyBulkWriteOperation<PoliticalParty>[] = [];
  for (const party of parties) {
    const correct = liveCount.get(key(String(party.sequentialId), party.countryId)) ?? 0;
    if (party.memberCount !== correct) {
      ops.push({
        updateOne: {
          filter: { sequentialId: party.sequentialId, countryId: party.countryId },
          update: { $set: { memberCount: correct, updatedAt: now } },
        },
      });
    }
  }

  if (ops.length > 0) {
    await db.collection<PoliticalParty>("politicalParties").bulkWrite(ops);
  }

  return { partiesChecked: parties.length, partiesUpdated: ops.length };
}
