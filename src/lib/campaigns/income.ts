import type { Campaign } from "@/lib/db/types";
import {
  FUNDRAISING_INCOME,
  getCampaignFamilyScalar,
  getOpsBranchMagnitude,
  OPS_TREES,
} from "./upgradeCosts";

/**
 * Per-turn passive campaign income (anchor $ scaled by race family).
 *
 * Strategic Operations v2: when the campaign has a fundraising branch tree with
 * its starter unlocked, income is
 *   (starter base + Grassroots recurring) × (1 + Digital Ops multiplier)
 * where Grassroots is branch `a` (incomeFlat) and Digital Ops is branch `c`
 * (incomeMultiplier). Bundlers (branch `b`) is a one-time lump applied at
 * purchase (see campaignCommands) and does NOT recur here.
 *
 * Legacy fallback: rows not yet migrated to the tree (no `fundraisingTree` or
 * starter not set) read the old `fundraisingLevel` lookup so income is
 * unchanged until the migration backfills them. An un-started tree still pays
 * the L0 base ($20k) that every campaign earns with no upgrade.
 */
export function calculateCampaignIncome(campaign: Campaign, electionType?: string): number {
  const scalar = getCampaignFamilyScalar(electionType);
  const tree = campaign.fundraisingTree;

  if (tree?.starter) {
    const base =
      OPS_TREES.fundraising.starter.magnitude + getOpsBranchMagnitude("fundraising", "a", tree.a);
    const multiplier = 1 + getOpsBranchMagnitude("fundraising", "c", tree.c);
    return Math.round(base * multiplier * scalar);
  }

  // No tree / un-started: legacy linear level (0 on fresh v2 rows → $20k base).
  const level = Math.min(Math.max(campaign.fundraisingLevel ?? 0, 0), 10);
  return Math.round(FUNDRAISING_INCOME[level] * scalar);
}
