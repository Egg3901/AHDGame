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

/**
 * Maximum simultaneous campaign managers. Raised from an implicit 1 (a single
 * `managerId` field) so a serious campaign can split the work — one person on
 * media, one on presence, one on opposition research — instead of funnelling
 * every action through the nominee or a lone manager.
 */
export const MAX_CAMPAIGN_MANAGERS = 3;

/**
 * Every user id currently managing this campaign.
 *
 * Back-compat: campaigns written before the multi-manager change carry a single
 * `managerId`/`managerCharacterId` pair and no `managers` array. Both shapes are
 * read here so no migration/backfill is required — the legacy pair is folded in
 * and de-duplicated against the array. New writes populate `managers`, and keep
 * the legacy pair mirrored to the FIRST manager so any un-migrated reader (and
 * the existing UI) still resolves someone sensible.
 */
export function campaignManagerUserIds(campaign: Campaign): ObjectId[] {
  const out: ObjectId[] = [];
  const seen = new Set<string>();
  const push = (id: ObjectId | null | undefined) => {
    if (!id) return;
    const key = id.toString();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(id);
  };
  push(campaign.managerId);
  for (const m of campaign.managers ?? []) push(m.userId);
  return out;
}

/**
 * The legacy single-manager pair expressed as a `managers` list, for campaigns
 * written before the multi-manager change. Returns `[]` when there was no
 * manager, or when the legacy pair is half-populated (which would otherwise
 * produce an entry with a missing characterId).
 */
export function legacyManagersAsList(campaign: Campaign): NonNullable<Campaign["managers"]> {
  if (!campaign.managerId || !campaign.managerCharacterId) return [];
  return [
    {
      userId: campaign.managerId,
      characterId: campaign.managerCharacterId,
      appointedAt: campaign.updatedAt ?? new Date(0),
    },
  ];
}

export function isCampaignManagerUser(campaign: Campaign, userId: string): boolean {
  let asObjectId: ObjectId;
  try {
    asObjectId = new ObjectId(userId);
  } catch {
    return false;
  }
  return campaignManagerUserIds(campaign).some((id) => id.equals(asObjectId));
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
