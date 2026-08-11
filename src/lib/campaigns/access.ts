import { ObjectId, type Db } from "mongodb";
import type { Campaign } from "@/lib/db/types";

export async function isCampaignNomineeUser(
  db: Db,
  campaign: Campaign,
  userId: string,
  activeCharacterId?: ObjectId | string | null
): Promise<boolean> {
  if (campaign.candidateIsNPP) return false;

  if (activeCharacterId) {
    const activeId =
      activeCharacterId instanceof ObjectId ? activeCharacterId : new ObjectId(activeCharacterId);
    if (campaign.candidateId.equals(activeId)) {
      return true;
    }
  }

  const ownedCandidate = await db
    .collection("characters")
    .findOne(
      { _id: campaign.candidateId, userId: new ObjectId(userId) },
      { projection: { _id: 1 } }
    );
  return ownedCandidate?._id?.equals(campaign.candidateId) ?? false;
}

export function isCampaignManagerUser(campaign: Campaign, userId: string): boolean {
  return campaign.managerId?.equals(new ObjectId(userId)) ?? false;
}

export async function getCampaignActorAccess(
  db: Db,
  campaign: Campaign,
  userId: string,
  activeCharacterId?: ObjectId | string | null
): Promise<{ isManager: boolean; isNominee: boolean }> {
  const [isManager, isNominee] = await Promise.all([
    Promise.resolve(isCampaignManagerUser(campaign, userId)),
    isCampaignNomineeUser(db, campaign, userId, activeCharacterId),
  ]);
  return { isManager, isNominee };
}
