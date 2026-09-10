/**
 * What an operations lever is doing for a campaign *right now*.
 *
 * The ops tree stores what each next tier costs and what it will add, but
 * nothing records a lever's current standing effect. The Blend campaign board
 * shows one summary line per lever ("+$270,250/turn income"), so this derives
 * it from the tiers already purchased.
 *
 * Display only. It reads the same `OPS_TREES` magnitudes the effect code
 * consumes, but it does not feed resolution: `campaignTurn.ts`, `income.ts`,
 * `maintenance.ts` and `presidentialElectionEngine.ts` remain the authorities
 * on what actually happens.
 */

import {
  OPS_TREES,
  type OpsBranchKey,
  type OpsEffectType,
  type UpgradeCategory,
} from "@/lib/campaigns/upgradeCosts";

export interface OpsTreeState {
  starter: boolean;
  a: number;
  b: number;
  c: number;
}

export type OpsChannelTotals = Partial<Record<OpsEffectType, number>>;

/** The channel each lever's starter feeds, and how much it grants. */
const STARTER_CHANNEL: Record<UpgradeCategory, OpsEffectType> = {
  fundraising: "incomeFlat",
  oppositionResearch: "oppoFavPerTurn",
  groundGame: "swingPct",
  mediaSpending: "favPerTurn",
};

/**
 * Channels whose magnitude is paid once at purchase rather than held as a
 * standing effect. They contribute nothing to a "currently doing" summary.
 */
const ON_PURCHASE_CHANNELS: ReadonlySet<OpsEffectType> = new Set<OpsEffectType>([
  "incomeLumpOnPurchase",
  "oppoLumpOnPurchase",
]);

/**
 * Total standing effect per channel for one lever at its current tiers.
 *
 * Branch tier magnitudes are cumulative at that tier (not per-tier deltas), so
 * a branch contributes exactly its current tier's magnitude.
 */
export function opsChannelTotals(
  category: UpgradeCategory,
  tree: OpsTreeState | undefined
): OpsChannelTotals {
  // A locked lever has no effect at all, including no starter grant.
  if (!tree?.starter) return {};

  const def = OPS_TREES[category];
  const totals: OpsChannelTotals = {};

  const add = (channel: OpsEffectType, amount: number) => {
    if (ON_PURCHASE_CHANNELS.has(channel) || amount === 0) return;
    totals[channel] = (totals[channel] ?? 0) + amount;
  };

  add(STARTER_CHANNEL[category], def.starter.magnitude);

  for (const branch of def.branches) {
    const level = tree[branch.key as OpsBranchKey] ?? 0;
    if (level <= 0) continue;
    const tier = branch.tiers.find((t) => t.level === level);
    if (!tier) continue;
    add(branch.effectType, tier.magnitude);
  }

  return totals;
}

function money(amount: number, symbol: string): string {
  return `${symbol}${Math.round(amount).toLocaleString("en-US")}`;
}

/** Trim a percentage to at most one decimal without a trailing ".0". */
function pct(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

/**
 * One line describing what the lever is currently doing, in the campaign's own
 * currency. Returns "Not yet unlocked" for a lever whose starter is unbought,
 * which is honest where a "+$0/turn" would read as a broken figure.
 */
export function describeOpsCurrentEffect(
  category: UpgradeCategory,
  tree: OpsTreeState | undefined,
  currencySymbol: string
): string {
  if (!tree?.starter) return "Not yet unlocked";

  const t = opsChannelTotals(category, tree);

  if (category === "fundraising") {
    const base = t.incomeFlat ?? 0;
    const multiplied = base * (1 + (t.incomeMultiplier ?? 0));
    return `+${money(multiplied, currencySymbol)}/turn income`;
  }

  if (category === "oppositionResearch") {
    const drain = (t.oppoFavPerTurn ?? 0) * (1 + (t.oppoAmpPct ?? 0));
    const shield = t.oppoShieldPct ?? 0;
    const parts = [`-${pct(drain)} target fav/turn`];
    if (shield > 0) parts.push(`${pct(shield * 100)} incoming oppo blunted`);
    return parts.join(" · ");
  }

  if (category === "groundGame") {
    const parts = [`+${pct(t.swingPct ?? 0)} in swing areas`];
    if ((t.gotvPct ?? 0) > 0) parts.push(`+${pct(t.gotvPct ?? 0)} everywhere`);
    if ((t.maintReductionPct ?? 0) > 0) {
      parts.push(`${pct((t.maintReductionPct ?? 0) * 100)} lower upkeep`);
    }
    return parts.join(" · ");
  }

  // mediaSpending
  const parts = [`+${pct(t.favPerTurn ?? 0)}/turn favorability`];
  if ((t.oppoShieldPct ?? 0) > 0) {
    parts.push(`${pct((t.oppoShieldPct ?? 0) * 100)} incoming oppo blunted`);
  }
  return parts.join(" · ");
}
