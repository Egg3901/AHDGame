import { getDb } from "@/lib/mongodb";
import type { Campaign, CampaignFogOfWar } from "@/lib/db/types";
import { getMaxLevel } from "./upgradeCosts";

/**
 * Applies ± variance jitter, then clamps to [0, max].
 * Clamping matters because opponent views showed impossible levels (e.g. 8 for
 * categories capped at 5), making rival campaigns appear to have different caps
 * than the viewer's own campaign.
 */
export function applyFog(actualLevel: number, variance: number, max: number): number {
  const offset = Math.floor(Math.random() * (variance * 2 + 1)) - variance;
  const raw = actualLevel + offset;
  return Math.max(0, Math.min(max, raw));
}

export async function updateCampaignFogOfWar(): Promise<void> {
  try {
    const db = await getDb();
    const campaigns = await db.collection<Campaign>("campaigns").find({}).toArray();

    if (campaigns.length === 0) {
      return; // No campaigns to update
    }

    const now = new Date();
    const updates = [];

    const maxFundraising = getMaxLevel("fundraising");
    const maxOpposition = getMaxLevel("oppositionResearch");
    const maxGroundGame = getMaxLevel("groundGame");
    const maxMedia = getMaxLevel("mediaSpending");

    for (const campaign of campaigns) {
      try {
        const publicFogOfWar: CampaignFogOfWar = {
          fundraisingLevel: applyFog(campaign.fundraisingLevel, 3, maxFundraising),
          oppositionResearchLevel: applyFog(campaign.oppositionResearchLevel, 3, maxOpposition),
          groundGameLevel: applyFog(campaign.groundGameLevel, 3, maxGroundGame),
          mediaSpendingLevel: applyFog(campaign.mediaSpendingLevel, 3, maxMedia),
          lastUpdated: now,
        };

        const partyFogOfWar: CampaignFogOfWar = {
          fundraisingLevel: applyFog(campaign.fundraisingLevel, 1, maxFundraising),
          oppositionResearchLevel: applyFog(campaign.oppositionResearchLevel, 1, maxOpposition),
          groundGameLevel: applyFog(campaign.groundGameLevel, 1, maxGroundGame),
          mediaSpendingLevel: applyFog(campaign.mediaSpendingLevel, 1, maxMedia),
          lastUpdated: now,
        };

        updates.push({
          updateOne: {
            filter: { _id: campaign._id },
            update: {
              $set: {
                publicFogOfWar,
                partyFogOfWar,
                updatedAt: now,
              },
            },
          },
        });
      } catch (error) {
        console.error(`[Fog Update] Error preparing fog for campaign ${campaign._id}:`, error);
        // Continue with other campaigns
      }
    }

    // Bulk write all updates at once
    if (updates.length > 0) {
      await db.collection<Campaign>("campaigns").bulkWrite(updates);
      console.log(`[Fog Update] Updated fog of war for ${updates.length} campaign(s)`);
    }
  } catch (error) {
    console.error("[Fog Update] Fatal error updating campaign fog:", error);
    throw error; // Re-throw fatal errors
  }
}
