/**
 * Coalition chair-character sync helpers.
 *
 * A coalition stores BOTH the lead party (`chairPartyId`) and the lead
 * party's chair character (`chairCharacterId`) so the UI can render the
 * chair's name + character link without a join. The two fields can
 * drift out of sync because:
 *
 *   - `applyRemoveOfficeHolderEffect` clears `Party.chairId` to null
 *   - `vacatePartyLeadershipForBannedUser` clears chair for a banned
 *     user's character
 *   - `retireCharacter` clears chair when the character retires
 *   - `emptyPartyCleanup` clears chair on a party reduced to NPPs
 *   - admin settings / appointment routes overwrite chair directly
 *   - `processMergeProposal` clears chair on a party that's merging
 *     into another
 *
 * Only `nationalPartyElections.ts`'s resolver previously synced
 * coalitions when the chair changed — every other path left the
 * coalition's `chairCharacterId` pointing at the stale character.
 * Players see this as "the coalition chair is the old chair, not the
 * new one".
 *
 * Two surfaces:
 *
 *   - `syncCoalitionChairsForParty(db, partyId, now)` — call right after
 *     mutating a party's `chairId`. Idempotent.
 *   - `reconcileAllCoalitionChairs(db, now)` — defensive sweep meant
 *     for the per-turn phase. Reads every coalition's lead party and
 *     re-syncs any mismatched chairs in one bulk write. Safety net
 *     for paths that forget to call the per-mutation helper.
 *
 * See the 2026-05-23 coalition-chair-sync fix (reported by the
 * walkthrough user — "Party that leads a Coalition loses/changes its
 * Chair, the Chair of the Coalition still stays as the old Chair").
 */

import type { Db, ObjectId } from "mongodb";
import type { Coalition, PoliticalParty } from "@/lib/db/types";

/**
 * Re-syncs every coalition led by `partyId` to point at the party's
 * CURRENT `chairId`. No-op when the party has no coalition-leadership
 * rows or when the chair is already in sync.
 *
 * Reads the latest `chairId` from the party row, so the caller doesn't
 * have to pass it explicitly — the helper is robust to "I just updated
 * chairId and now want to sync".
 */
export async function syncCoalitionChairsForParty(
  db: Db,
  partyId: ObjectId,
  now: Date = new Date()
): Promise<number> {
  const party = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne({ _id: partyId }, { projection: { chairId: 1 } });
  // Note: party may exist with chairId === null (vacant) — that's a
  // legitimate sync target, not a skip case.
  if (!party) return 0;
  const newChairId = party.chairId ?? null;
  const result = await db
    .collection<Coalition>("coalitions")
    .updateMany(
      { chairPartyId: partyId, chairCharacterId: { $ne: newChairId } as unknown as ObjectId },
      { $set: { chairCharacterId: newChairId as ObjectId, updatedAt: now } }
    );
  return result.modifiedCount;
}

/**
 * Per-turn defensive sweep: scans every coalition, looks up the lead
 * party's current chair, and updates any rows where they've drifted.
 *
 * Single read of all coalitions + one batched read of the referenced
 * parties + at most one batched write. O(N) coalitions, not per-party.
 *
 * Intended to run in the same per-turn phase that already processes
 * national-committee + national-party elections. Even if every per-
 * mutation site calls `syncCoalitionChairsForParty` correctly, this
 * sweep catches paths added later that forget to.
 */
export async function reconcileAllCoalitionChairs(db: Db, now: Date = new Date()): Promise<number> {
  const coalitions = await db
    .collection<Coalition>("coalitions")
    .find({}, { projection: { _id: 1, chairPartyId: 1, chairCharacterId: 1 } })
    .toArray();
  if (coalitions.length === 0) return 0;

  const partyIds = Array.from(new Set(coalitions.map((c) => c.chairPartyId.toString()))).map(
    (s) => coalitions.find((c) => c.chairPartyId.toString() === s)!.chairPartyId
  );

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ _id: { $in: partyIds } }, { projection: { _id: 1, chairId: 1 } })
    .toArray();
  const chairByParty = new Map<string, ObjectId | null>(
    parties.map((p) => [p._id.toString(), p.chairId ?? null])
  );

  // Build per-coalition updates only where the stored chairCharacterId
  // differs from the lead party's current chairId.
  const mismatches = coalitions.filter((c) => {
    const expected = chairByParty.get(c.chairPartyId.toString()) ?? null;
    const stored = c.chairCharacterId ?? null;
    if (expected == null && stored == null) return false;
    if (expected == null || stored == null) return true;
    return !expected.equals(stored);
  });
  if (mismatches.length === 0) return 0;

  const ops = mismatches.map((c) => {
    const expected = chairByParty.get(c.chairPartyId.toString()) ?? null;
    return {
      updateOne: {
        filter: { _id: c._id },
        update: {
          $set: { chairCharacterId: expected as ObjectId, updatedAt: now },
        },
      },
    };
  });
  await db.collection<Coalition>("coalitions").bulkWrite(ops);
  return mismatches.length;
}
