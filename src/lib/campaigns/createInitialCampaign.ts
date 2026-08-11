/**
 * Shared helper: builds the initial Campaign doc for a freshly-entered
 * election candidate. Used from:
 *   - POST /api/elections/[id]/enter (player entry)
 *   - POST /api/admin/elections/[id]/place-candidate (admin placement)
 *   - start-general admin route (fallback for legacy races that never
 *     had a campaign created at entry)
 *
 * Idempotent — checks for an existing campaign doc by electionId +
 * candidateId and returns the existing one instead of inserting a duplicate.
 */

import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Campaign } from "@/lib/db/types";

export interface CreateInitialCampaignArgs {
  db: Db;
  electionId: ObjectId;
  candidateId: ObjectId;
  candidateIsNPP: boolean;
  party: string;
  now?: Date;
}

/**
 * Create a campaign doc for this candidate if one doesn't already exist.
 * Returns the campaign's ObjectId. No-op when a campaign already exists.
 */
export async function createInitialCampaign({
  db,
  electionId,
  candidateId,
  candidateIsNPP,
  party,
  now = new Date(),
}: CreateInitialCampaignArgs): Promise<ObjectId> {
  const existing = await db
    .collection<Campaign>("campaigns")
    .findOne({ electionId, candidateId }, { projection: { _id: 1 } });
  if (existing) return existing._id;

  const fogOfWar = {
    fundraisingLevel: 0,
    oppositionResearchLevel: 0,
    groundGameLevel: 0,
    mediaSpendingLevel: 0,
    lastUpdated: now,
  };

  const doc: Campaign = {
    _id: new ObjectId(),
    electionId,
    candidateId,
    candidateIsNPP,
    party,
    status: "active",
    archivedAt: null,
    managerId: null,
    managerCharacterId: null,
    funds: 0,
    actions: 0,
    fundraisingLevel: 0,
    oppositionResearchLevel: 0,
    groundGameLevel: 0,
    mediaSpendingLevel: 0,
    oppositionTargetId: null,
    oppositionTargetName: null,
    oppositionResearchCooldownUntil: null,
    oppositionResearchCooldownUntilTurn: null,
    donationLog: [],
    publicFogOfWar: fogOfWar,
    partyFogOfWar: fogOfWar,
    activityHistory: [],
    totalFundsGenerated: 0,
    totalFundsSpent: 0,
    totalActionsGenerated: 0,
    totalActionsSpent: 0,
    // Accumulated campaign strength from player contributions — starts at 0.
    campaignStrength: 0,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<Campaign>("campaigns").insertOne(doc);
  return doc._id;
}

/**
 * Guarantee that an active candidate has a live (non-archived) campaign.
 * Single source of truth for self-heal / backfill paths:
 *   - no campaign exists  → create one (delegates to createInitialCampaign)
 *   - archived campaign   → reactivate it (status back to "active")
 *   - active campaign     → no-op
 *
 * Reactivation (rather than hard-delete + recreate) preserves any retained
 * funds / levels / activity on a campaign that was archived when the candidate
 * lost a primary or withdrew and then re-entered. Returns the campaign's
 * ObjectId in all cases.
 */
export async function ensureCampaignForCandidate({
  db,
  electionId,
  candidateId,
  candidateIsNPP,
  party,
  now = new Date(),
}: CreateInitialCampaignArgs): Promise<ObjectId> {
  const existing = await db
    .collection<Campaign>("campaigns")
    .findOne({ electionId, candidateId }, { projection: { _id: 1, status: 1 } });

  if (!existing) {
    return createInitialCampaign({ db, electionId, candidateId, candidateIsNPP, party, now });
  }

  // Missing status is treated as active (legacy rows) — no-op.
  if (existing.status === "archived") {
    await db.collection<Campaign>("campaigns").updateOne(
      { _id: existing._id },
      {
        $set: { status: "active", archivedAt: null, updatedAt: now },
        $unset: { archivedReason: "" },
      }
    );
  }

  return existing._id;
}
