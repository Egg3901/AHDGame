import { UPGRADE_COSTS } from "./upgradeCosts";

export type DowngradableCategory = "groundGame" | "mediaSpending";

export interface DowngradeEntry {
  category: DowngradableCategory;
  fromLevel: number;
  toLevel: number;
}

export interface AutoDowngradeInput {
  funds: number;
  income: number;
  groundGameLevel: number;
  mediaSpendingLevel: number;
}

export interface AutoDowngradeResult {
  newGroundGameLevel: number;
  newMediaSpendingLevel: number;
  /**
   * Maintenance cost after applying the downgrades. Use this for the actual
   * funds deduction in the same turn — not the pre-downgrade maintenance.
   */
  newMaintenance: number;
  /**
   * Sequential list of demotions in the order they were applied. Each entry
   * represents a single-level drop. Empty when the campaign was already solvent.
   */
  downgrades: DowngradeEntry[];
}

function levelMaintenance(category: DowngradableCategory, level: number): number {
  if (level <= 0) return 0;
  const tier = UPGRADE_COSTS[category][level - 1];
  return tier && "maintenance" in tier && typeof tier.maintenance === "number"
    ? tier.maintenance
    : 0;
}

function totalMaintenance(groundLevel: number, mediaLevel: number): number {
  let total = 0;
  for (let i = 1; i <= groundLevel; i++) total += levelMaintenance("groundGame", i);
  for (let i = 1; i <= mediaLevel; i++) total += levelMaintenance("mediaSpending", i);
  return total;
}

/**
 * Compute the minimal set of single-level demotions needed to keep a campaign
 * solvent this turn. A campaign is solvent when post-income funds cover the
 * per-turn maintenance: `funds + income >= maintenance`. When that fails, drop
 * the tier with the higher incremental maintenance at its current level (tie
 * goes to Media Spending — advertising pulls faster than canvassers). Repeat
 * until solvent or both tiers reach level 0.
 *
 * Termination: each iteration strictly decreases maintenance and one level
 * counter; both levels at 0 yields zero maintenance, which is always solvent
 * when income >= funds (true after the fix pairs with a non-negative funds
 * floor in the caller — here we simply stop demoting).
 */
export function computeAutoDowngrade(input: AutoDowngradeInput): AutoDowngradeResult {
  let ground = Math.max(0, Math.floor(input.groundGameLevel));
  let media = Math.max(0, Math.floor(input.mediaSpendingLevel));
  const downgrades: DowngradeEntry[] = [];

  let maintenance = totalMaintenance(ground, media);
  const projected = input.funds + input.income;

  while (maintenance > projected && (ground > 0 || media > 0)) {
    const groundIncremental = ground > 0 ? levelMaintenance("groundGame", ground) : -1;
    const mediaIncremental = media > 0 ? levelMaintenance("mediaSpending", media) : -1;

    // Tie-break: Media Spending first (advertising easier to pull). When one
    // tier is already at 0 the other is forced.
    const demoteMedia = media > 0 && (ground === 0 || mediaIncremental >= groundIncremental);

    if (demoteMedia) {
      downgrades.push({ category: "mediaSpending", fromLevel: media, toLevel: media - 1 });
      media -= 1;
    } else {
      downgrades.push({ category: "groundGame", fromLevel: ground, toLevel: ground - 1 });
      ground -= 1;
    }
    maintenance = totalMaintenance(ground, media);
  }

  return {
    newGroundGameLevel: ground,
    newMediaSpendingLevel: media,
    newMaintenance: maintenance,
    downgrades,
  };
}
