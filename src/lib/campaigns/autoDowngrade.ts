import type { Campaign, CampaignOpsTree } from "@/lib/db/types";
import {
  getMaintenanceCost,
  getTreeMaintenanceCost,
  OPS_TREES,
  type OpsBranchKey,
  type UpgradeCategory,
} from "./upgradeCosts";

export type DowngradableCategory = "groundGame" | "mediaSpending";

export interface DowngradeEntry {
  category: UpgradeCategory;
  /** Branch that was demoted (tree model); absent for legacy level demotions. */
  branch?: OpsBranchKey;
  fromLevel: number;
  toLevel: number;
}

export interface AutoDowngradeResult {
  /** Maintenance (anchor $, pre-family-scalar aggregate) after demotions. */
  newMaintenance: number;
  /**
   * Mongo `$set` fields encoding the demotions, e.g. `{ "groundGameTree.a": 1 }`,
   * `{ "groundGameTree.starter": false }`, or legacy `{ mediaSpendingLevel: 2 }`.
   * Empty when already solvent.
   */
  setFields: Record<string, unknown>;
  /** Ordered single-step demotions applied. Empty when already solvent. */
  downgrades: DowngradeEntry[];
}

interface WorkingTree extends CampaignOpsTree {
  started: boolean;
}

/**
 * Compute the minimal set of single-step demotions to keep a campaign solvent
 * this turn (`funds + income >= maintenance`). Strategic Operations v2: demotes
 * the maintenance-bearing branch tier with the highest incremental upkeep,
 * across every started lever tree (Ground Game field offices / GOTV, Media
 * broadcast / digital / rapid response, Fundraising digital ops). Levers still
 * on the legacy linear model demote their old `groundGameLevel` /
 * `mediaSpendingLevel` instead. Repeats until solvent or nothing left to cut.
 *
 * Termination: each iteration strictly lowers one level counter and (because
 * only maintenance-bearing tiers are candidates) strictly lowers maintenance;
 * with nothing left to demote the loop exits.
 */
export function computeAutoDowngrade(
  campaign: Pick<
    Campaign,
    | "fundraisingTree"
    | "groundGameTree"
    | "mediaSpendingTree"
    | "oppositionResearchTree"
    | "fundraisingLevel"
    | "groundGameLevel"
    | "mediaSpendingLevel"
    | "oppositionResearchLevel"
  >,
  input: { funds: number; income: number; electionType?: string }
): AutoDowngradeResult {
  const { funds, income, electionType } = input;
  const projected = funds + income;

  // Working copy of each lever's tree state (or legacy level).
  const trees: Record<UpgradeCategory, WorkingTree> = {
    fundraising: toWorking(campaign.fundraisingTree),
    groundGame: toWorking(campaign.groundGameTree),
    mediaSpending: toWorking(campaign.mediaSpendingTree),
    oppositionResearch: toWorking(campaign.oppositionResearchTree),
  };
  const legacyLevels: Record<UpgradeCategory, number> = {
    fundraising: Math.max(0, Math.floor(campaign.fundraisingLevel ?? 0)),
    groundGame: Math.max(0, Math.floor(campaign.groundGameLevel ?? 0)),
    mediaSpending: Math.max(0, Math.floor(campaign.mediaSpendingLevel ?? 0)),
    oppositionResearch: Math.max(0, Math.floor(campaign.oppositionResearchLevel ?? 0)),
  };

  const setFields: Record<string, unknown> = {};
  const downgrades: DowngradeEntry[] = [];

  const total = () => aggregateMaintenance(trees, legacyLevels, electionType);
  let maintenance = total();

  // Legacy categories that carry maintenance in the old model.
  const legacyDowngradable: DowngradableCategory[] = ["groundGame", "mediaSpending"];

  let guard = 0;
  while (maintenance > projected && guard++ < 64) {
    // Build the candidate demotion set: (delta maintenance, apply()).
    let best: { delta: number; apply: () => void } | null = null;

    for (const category of Object.keys(trees) as UpgradeCategory[]) {
      const tree = trees[category];
      if (tree.started) {
        for (const branchDef of OPS_TREES[category].branches) {
          const level = tree[branchDef.key];
          if (level <= 0) continue;
          if (!branchDef.tiers.some((t) => (t.maintenance ?? 0) > 0)) continue;
          const before = maintenance;
          tree[branchDef.key] = level - 1;
          const after = total();
          tree[branchDef.key] = level; // restore
          const delta = before - after;
          if (delta > 0 && (!best || delta > best.delta)) {
            best = {
              delta,
              apply: () => {
                tree[branchDef.key] = level - 1;
                setFields[`${category}Tree.${branchDef.key}`] = level - 1;
                downgrades.push({
                  category,
                  branch: branchDef.key,
                  fromLevel: level,
                  toLevel: level - 1,
                });
              },
            };
          }
        }
        // Last resort: once every maintenance-bearing branch is at 0, the
        // starter's own upkeep can still be shed by dropping the whole lever
        // (starter → false). Gated so upkeep branches always shed first; a
        // zero-upkeep branch (e.g. Volunteer Corps) does not block the shed but
        // is zeroed alongside it so nothing is stranded behind a dead starter.
        const upkeepBranchesZero = OPS_TREES[category].branches.every(
          (bd) => tree[bd.key] === 0 || !bd.tiers.some((t) => (t.maintenance ?? 0) > 0)
        );
        if (upkeepBranchesZero && (OPS_TREES[category].starter.maintenance ?? 0) > 0) {
          const before = maintenance;
          const saved = { a: tree.a, b: tree.b, c: tree.c };
          tree.started = false;
          tree.a = 0;
          tree.b = 0;
          tree.c = 0;
          const after = total();
          tree.started = true; // restore
          tree.a = saved.a;
          tree.b = saved.b;
          tree.c = saved.c;
          const delta = before - after;
          if (delta > 0 && (!best || delta > best.delta)) {
            best = {
              delta,
              apply: () => {
                tree.started = false;
                tree.a = 0;
                tree.b = 0;
                tree.c = 0;
                // Drop any per-path branch sets from earlier iterations — Mongo
                // rejects $set on both `x.a` and `x` in one update.
                delete setFields[`${category}Tree.a`];
                delete setFields[`${category}Tree.b`];
                delete setFields[`${category}Tree.c`];
                setFields[`${category}Tree`] = { starter: false, a: 0, b: 0, c: 0 };
                downgrades.push({ category, fromLevel: 1, toLevel: 0 });
              },
            };
          }
        }
      } else if (legacyDowngradable.includes(category as DowngradableCategory)) {
        const level = legacyLevels[category];
        if (level <= 0) continue;
        const before = maintenance;
        legacyLevels[category] = level - 1;
        const after = total();
        legacyLevels[category] = level; // restore
        const delta = before - after;
        if (delta > 0 && (!best || delta > best.delta)) {
          best = {
            delta,
            apply: () => {
              legacyLevels[category] = level - 1;
              setFields[`${category}Level`] = level - 1;
              downgrades.push({ category, fromLevel: level, toLevel: level - 1 });
            },
          };
        }
      }
    }

    if (!best) break; // nothing left to demote
    best.apply();
    maintenance = total();
  }

  return { newMaintenance: maintenance, setFields, downgrades };
}

function toWorking(tree: CampaignOpsTree | undefined): WorkingTree {
  return {
    started: !!tree?.starter,
    starter: !!tree?.starter,
    a: Math.max(0, Math.floor(tree?.a ?? 0)),
    b: Math.max(0, Math.floor(tree?.b ?? 0)),
    c: Math.max(0, Math.floor(tree?.c ?? 0)),
  };
}

function aggregateMaintenance(
  trees: Record<UpgradeCategory, WorkingTree>,
  legacyLevels: Record<UpgradeCategory, number>,
  electionType?: string
): number {
  let total = 0;
  for (const category of Object.keys(trees) as UpgradeCategory[]) {
    const tree = trees[category];
    if (tree.started) {
      total += getTreeMaintenanceCost(category, tree, electionType);
    } else {
      total += getMaintenanceCost(category, legacyLevels[category], electionType);
    }
  }
  return total;
}
