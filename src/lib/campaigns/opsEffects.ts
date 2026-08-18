import type { Campaign, CampaignOpsTree } from "@/lib/db/types";
import { getOpsBranchMagnitude, OPS_TREES } from "./upgradeCosts";

/**
 * Strategic Operations v2 — per-turn / per-election effect readers.
 *
 * Each reader takes a campaign and returns the current effective magnitude of
 * one effect channel from the relevant branch tree, with a legacy fallback to
 * the old linear-level formula when that lever's tree isn't started yet. This
 * keeps the tree math in one place so the turn processor and the presidential
 * election engine read effects identically.
 */

/** Media favorability gained per turn (before season multiplier). */
export function getMediaFavPerTurn(campaign: Campaign): number {
  const tree = campaign.mediaSpendingTree;
  if (tree?.starter) {
    // Broadcast (a) + Digital Ads (b) both feed favPerTurn; starter is the base.
    return (
      OPS_TREES.mediaSpending.starter.magnitude +
      getOpsBranchMagnitude("mediaSpending", "a", tree.a) +
      getOpsBranchMagnitude("mediaSpending", "b", tree.b)
    );
  }
  return (campaign.mediaSpendingLevel ?? 0) * 0.5;
}

/**
 * Opposition-research favorability drain this campaign inflicts per turn
 * (returned as a positive magnitude). Counter-Intel (c) amplifies the recurring
 * Dossier (a) + starter drain. The incoming shield on the *target* is applied by
 * the caller, not here.
 */
export function getOppoDrainPerTurn(campaign: Campaign): number {
  const tree = campaign.oppositionResearchTree;
  if (tree?.starter) {
    const base =
      OPS_TREES.oppositionResearch.starter.magnitude +
      getOpsBranchMagnitude("oppositionResearch", "a", tree.a);
    const amp = 1 + getOpsBranchMagnitude("oppositionResearch", "c", tree.c);
    return base * amp;
  }
  return (campaign.oppositionResearchLevel ?? 0) * 0.5;
}

/** Ground-game swing-area bonus as a fraction (e.g. 0.15 = +15%). */
export function getGroundGameSwingBonus(
  tree: CampaignOpsTree | undefined,
  legacyLevel: number
): number {
  if (tree?.starter) {
    return (
      (OPS_TREES.groundGame.starter.magnitude + getOpsBranchMagnitude("groundGame", "a", tree.a)) /
      100
    );
  }
  return legacyLevel * 0.03;
}

/** Ground-game GOTV all-areas turnout bonus as a fraction (0 unless tree-started). */
export function getGroundGameGotvBonus(tree: CampaignOpsTree | undefined): number {
  if (!tree?.starter) return 0;
  return getOpsBranchMagnitude("groundGame", "b", tree.b) / 100;
}
