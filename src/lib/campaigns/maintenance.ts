import type { Campaign } from "@/lib/db/types";
import type { DowngradeEntry } from "./autoDowngrade";
import {
  getMaintenanceCost,
  getTreeMaintenanceCost,
  OPS_TREES,
  type UpgradeCategory,
} from "./upgradeCosts";

/**
 * Per-turn maintenance for a campaign's Strategic Operations upkeep (anchor $
 * scaled by race family).
 *
 * Strategic Operations v2: sums maintenance across every lever's branch tree
 * (Ground Game field offices / GOTV, Media broadcast / digital / rapid
 * response, Fundraising digital ops), with each lever's own
 * `maintReductionPct` branch (e.g. Volunteer Corps) discounting its upkeep.
 * See `getTreeMaintenanceCost`.
 *
 * Legacy fallback per lever: a lever without a started tree reads the old
 * linear-level maintenance so unmigrated rows are unchanged.
 */
export function calculateMaintenanceCosts(campaign: Campaign, electionType?: string): number {
  const trees: Record<UpgradeCategory, Campaign["fundraisingTree"]> = {
    fundraising: campaign.fundraisingTree,
    oppositionResearch: campaign.oppositionResearchTree,
    groundGame: campaign.groundGameTree,
    mediaSpending: campaign.mediaSpendingTree,
  };
  const legacyLevel: Record<UpgradeCategory, number> = {
    fundraising: campaign.fundraisingLevel ?? 0,
    oppositionResearch: campaign.oppositionResearchLevel ?? 0,
    groundGame: campaign.groundGameLevel ?? 0,
    mediaSpending: campaign.mediaSpendingLevel ?? 0,
  };

  let total = 0;
  for (const category of Object.keys(OPS_TREES) as UpgradeCategory[]) {
    const tree = trees[category];
    if (tree?.starter) {
      total += getTreeMaintenanceCost(category, tree, electionType);
    } else {
      total += getMaintenanceCost(category, legacyLevel[category], electionType);
    }
  }
  return total;
}

/** Per-turn media-only upkeep, in anchor funds before currency conversion. */
export function calculateMediaMaintenanceCosts(campaign: Campaign, electionType?: string): number {
  return campaign.mediaSpendingTree?.starter
    ? getTreeMaintenanceCost("mediaSpending", campaign.mediaSpendingTree, electionType)
    : getMaintenanceCost("mediaSpending", campaign.mediaSpendingLevel ?? 0, electionType);
}

/** Media-only upkeep after the current turn's insolvency demotions. */
export function calculateMediaMaintenanceAfterDowngrade(
  campaign: Campaign,
  downgrades: DowngradeEntry[],
  electionType?: string
): number {
  const adjusted: Campaign = {
    ...campaign,
    mediaSpendingTree: campaign.mediaSpendingTree ? { ...campaign.mediaSpendingTree } : undefined,
  };
  for (const downgrade of downgrades) {
    if (downgrade.category !== "mediaSpending") continue;
    if (downgrade.branch && adjusted.mediaSpendingTree?.starter) {
      adjusted.mediaSpendingTree[downgrade.branch] = downgrade.toLevel;
    } else if (adjusted.mediaSpendingTree?.starter) {
      adjusted.mediaSpendingTree = { starter: false, a: 0, b: 0, c: 0 };
    } else {
      adjusted.mediaSpendingLevel = downgrade.toLevel;
    }
  }
  return calculateMediaMaintenanceCosts(adjusted, electionType);
}
