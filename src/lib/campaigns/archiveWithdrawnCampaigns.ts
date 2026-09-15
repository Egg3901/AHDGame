import type { Db, ObjectId } from "mongodb";
import type { Campaign, ElectionCandidate } from "@/lib/db/types";

export type CampaignArchiveReason = NonNullable<Campaign["archivedReason"]>;

/**
 * Minimal candidate identity needed to locate their campaign docs.
 * Player campaigns key `candidateId` by character; NPP campaigns may key by
 * the NPP id instead, so both are matched (see ticket #1310 follow-ups).
 */
export interface WithdrawnCandidateKeys {
  electionId: ObjectId;
  characterId: ObjectId;
  isNPP?: boolean;
  nppId?: ObjectId | null;
}

/**
 * Archive (never delete) the campaigns of withdrawn candidates so they stop
 * appearing on active surfaces such as Campaign Operations (ticket #1313).
 * A re-entry reactivates the campaign with its funds/levels intact via
 * `ensureCampaignForCandidate` / `createInitialCampaign`.
 *
 * Returns the number of campaigns archived.
 */
export async function archiveCampaignsForCandidates({
  db,
  candidates,
  reason,
  now = new Date(),
}: {
  db: Db;
  candidates: WithdrawnCandidateKeys[];
  reason: CampaignArchiveReason;
  now?: Date;
}): Promise<number> {
  if (candidates.length === 0) return 0;

  // One update per election keeps the filter sargable and avoids cross-race
  // collisions when a batch spans elections (e.g. resign-all).
  const byElection = new Map<string, { electionId: ObjectId; candidateIds: ObjectId[] }>();
  for (const c of candidates) {
    const key = c.electionId.toString();
    let group = byElection.get(key);
    if (!group) {
      group = { electionId: c.electionId, candidateIds: [] };
      byElection.set(key, group);
    }
    group.candidateIds.push(c.characterId);
    if (c.nppId) group.candidateIds.push(c.nppId);
  }

  let archived = 0;
  for (const { electionId, candidateIds } of byElection.values()) {
    // Never archive someone who is still standing in this race. A candidate can
    // hold a second, valid candidacy in the same election — the party-mismatch
    // sweep withdraws only the stale-party row when the character has already
    // re-entered under their new party. Archiving on the strength of the
    // withdrawn row alone would pull a live campaign out from under a candidate
    // who is still running (and lock them out of their own campaign actions).
    // Callers mark rows withdrawn before calling this, so the read is current.
    const stillStanding = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({
        electionId,
        status: "active",
        $or: [{ characterId: { $in: candidateIds } }, { nppId: { $in: candidateIds } }],
      })
      .project<{ characterId: ObjectId | null; nppId: ObjectId | null }>({
        characterId: 1,
        nppId: 1,
      })
      .toArray();

    const standingIds = new Set<string>();
    for (const row of stillStanding) {
      if (row.characterId) standingIds.add(row.characterId.toString());
      if (row.nppId) standingIds.add(row.nppId.toString());
    }

    const archivableIds = candidateIds.filter((id) => !standingIds.has(id.toString()));
    if (archivableIds.length === 0) continue;

    const result = await db.collection<Campaign>("campaigns").updateMany(
      {
        electionId,
        candidateId: { $in: archivableIds },
        status: { $ne: "archived" },
      },
      {
        $set: {
          status: "archived",
          archivedAt: now,
          archivedReason: reason,
          updatedAt: now,
        },
      }
    );
    archived += result.modifiedCount ?? 0;
  }
  return archived;
}
