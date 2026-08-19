export interface UpgradeCost {
  level: number;
  funds: number;
  actions: number;
  effect: string;
  maintenance?: number;
}

/**
 * Per-race-family budget scalar applied to fundraising income, upgrade
 * costs, and ongoing maintenance. The baseline magnitudes
 * (`FUNDRAISING_INCOME[10] = $5M/turn`, `L10 upgrade = $10M`) are sized
 * for a US presidential campaign. Smaller races have realistic
 * mid-six-figure to low-seven-figure budgets — scaling the curve keeps
 * the campaign manager UX coherent rather than asking a State Senate
 * candidate to raise presidential-scale money.
 *
 * Calibration:
 *   - president: 1.0× — baseline. ~$5M/turn at L10 fundraising.
 *   - governor / senate / non-US national: 0.5× — large statewide budgets.
 *   - house / regional council / landtag: 0.3× — district / regional scale.
 *   - stateSenate: 0.2× — low-six-figure district budgets.
 *   - ministerPresident: 0.4× — devolved-exec scale.
 *
 * Per-country national-legislature races (UK commons, JP shugiin /
 * sangiin, DE bundestag) sit at 0.5× — they're nationwide elections
 * but smaller per-candidate spend than US presidential.
 *
 * Unknown / missing election type degrades to 1.0× for backward compat.
 * Existing callers that don't pass `electionType` see no behavior change.
 */
export const CAMPAIGN_FAMILY_SCALAR_BY_ELECTION_TYPE: Readonly<Record<string, number>> = {
  president: 1.0,
  senate: 0.5,
  governor: 0.5,
  commons: 0.5,
  shugiin: 0.5,
  sangiin: 0.5,
  bundestag: 0.5,
  ministerPresident: 0.4,
  landtag: 0.4,
  house: 0.3,
  regionalCouncil: 0.3,
  stateSenate: 0.2,
  // CN: NPC sized as a non-US national legislature; Provincial People's
  // Congress mirrors regional-council scale.
  npcDelegate: 0.5,
  peoplesCongress: 0.3,
};

/**
 * Returns the budget scalar for a given election type. Backward-compat:
 * undefined / unknown election types return 1.0×.
 */
export function getCampaignFamilyScalar(electionType: string | undefined): number {
  if (!electionType) return 1.0;
  return CAMPAIGN_FAMILY_SCALAR_BY_ELECTION_TYPE[electionType] ?? 1.0;
}

/**
 * Per-turn passive income indexed by fundraisingLevel (0–10).
 */
export const FUNDRAISING_INCOME = [
  20_000, // L0 — base (no upgrade)
  35_000, // L1
  60_000, // L2
  100_000, // L3
  150_000, // L4
  200_000, // L5
  350_000, // L6
  600_000, // L7
  1_000_000, // L8
  2_500_000, // L9
  5_000_000, // L10
] as const;

export const UPGRADE_COSTS = {
  fundraising: [
    { level: 1, funds: 50_000, actions: 10, effect: "+$35k/turn" },
    { level: 2, funds: 120_000, actions: 15, effect: "+$60k/turn" },
    { level: 3, funds: 250_000, actions: 20, effect: "+$100k/turn" },
    { level: 4, funds: 500_000, actions: 25, effect: "+$150k/turn" },
    { level: 5, funds: 900_000, actions: 30, effect: "+$200k/turn" },
    { level: 6, funds: 1_500_000, actions: 40, effect: "+$350k/turn" },
    { level: 7, funds: 2_500_000, actions: 50, effect: "+$600k/turn" },
    { level: 8, funds: 4_000_000, actions: 60, effect: "+$1M/turn" },
    { level: 9, funds: 6_500_000, actions: 75, effect: "+$2.5M/turn" },
    { level: 10, funds: 10_000_000, actions: 90, effect: "+$5M/turn" },
  ],

  oppositionResearch: [
    { level: 1, funds: 40_000, actions: 8, effect: "-0.5%/turn to target" },
    { level: 2, funds: 80_000, actions: 12, effect: "-1.0%/turn to target" },
    { level: 3, funds: 160_000, actions: 16, effect: "-1.5%/turn to target" },
    { level: 4, funds: 320_000, actions: 20, effect: "-2.0%/turn to target" },
    { level: 5, funds: 640_000, actions: 24, effect: "-2.5%/turn to target" },
  ],

  groundGame: [
    { level: 1, funds: 55_000, actions: 10, effect: "+3% in swing states", maintenance: 5_500 },
    { level: 2, funds: 110_000, actions: 15, effect: "+6% in swing states", maintenance: 16_500 },
    { level: 3, funds: 220_000, actions: 20, effect: "+9% in swing states", maintenance: 38_500 },
    { level: 4, funds: 440_000, actions: 25, effect: "+12% in swing states", maintenance: 82_500 },
    { level: 5, funds: 880_000, actions: 30, effect: "+15% in swing states", maintenance: 170_500 },
  ],

  mediaSpending: [
    { level: 1, funds: 60_000, actions: 12, effect: "+0.5%/turn favorability", maintenance: 6_000 },
    {
      level: 2,
      funds: 120_000,
      actions: 16,
      effect: "+1.0%/turn favorability",
      maintenance: 18_000,
    },
    {
      level: 3,
      funds: 240_000,
      actions: 20,
      effect: "+1.5%/turn favorability",
      maintenance: 42_000,
    },
    {
      level: 4,
      funds: 480_000,
      actions: 24,
      effect: "+2.0%/turn favorability",
      maintenance: 90_000,
    },
    {
      level: 5,
      funds: 960_000,
      actions: 28,
      effect: "+2.5%/turn favorability",
      maintenance: 186_000,
    },
  ],
} as const;

export type UpgradeCategory = keyof typeof UPGRADE_COSTS;

// ---------------------------------------------------------------------------
// Strategic Operations v2 — branch-tree investment model
//
// Each lever becomes a tier-1 "starter" unlock plus three independently-
// levelled branch sub-tracks (a/b/c, each 0..OPS_MAX_BRANCH_LEVEL). The
// starter reproduces the old level-1 effect; branches extend it along three
// distinct channels. `effectType` tells the effect code (campaignTurn,
// income, presidentialElectionEngine) which channel a branch feeds; `magnitude`
// is the CUMULATIVE effect value at that tier (not per-tier delta) so consumers
// read the current tier's magnitude directly. `lumpSum` (anchor $) is the
// one-time payout/hit applied AT PURCHASE for on-purchase effect types.
//
// First-pass magnitudes preserve each lever's rough power ceiling from the old
// linear table; final balance is worldsim-validated before ship.
// ---------------------------------------------------------------------------

export const OPS_MAX_BRANCH_LEVEL = 3;

export type OpsBranchKey = "a" | "b" | "c";

/**
 * Effect channels a branch can feed. Consumed by name in the effect code — do
 * not rename without updating campaignTurn.ts / income.ts / maintenance.ts /
 * presidentialElectionEngine.ts.
 */
export type OpsEffectType =
  | "incomeFlat" // +anchor $/turn recurring campaign income
  | "incomeLumpOnPurchase" // one-time +anchor $ to funds at purchase
  | "incomeMultiplier" // ×(1+magnitude) on total fundraising income
  | "swingPct" // +% performance in swing areas (election engine)
  | "gotvPct" // +% turnout in ALL areas (election engine)
  | "maintReductionPct" // ×(1-magnitude) on THIS lever's maintenance
  | "favPerTurn" // +%/turn favorability to self
  | "oppoShieldPct" // ×(1-magnitude) on incoming opposition-research to self
  | "oppoFavPerTurn" // -%/turn favorability to the research target
  | "oppoLumpOnPurchase" // one-time -% favorability to target at purchase
  | "oppoAmpPct"; // ×(1+magnitude) on this campaign's oppoFavPerTurn output

export interface OpsBranchTier {
  level: number;
  funds: number;
  actions: number;
  /** Human-readable next-tier effect, e.g. "+$200k/turn". */
  effect: string;
  /** Cumulative numeric effect value at this tier (see OpsEffectType). */
  magnitude: number;
  /** One-time anchor $ payout/hit for *OnPurchase effect types. */
  lumpSum?: number;
  /** Recurring per-turn maintenance added by owning this tier. */
  maintenance?: number;
}

export interface OpsBranchDef {
  key: OpsBranchKey;
  label: string;
  effectType: OpsEffectType;
  description: string;
  tiers: OpsBranchTier[];
}

export interface OpsStarterDef {
  funds: number;
  actions: number;
  effect: string;
  /** Base magnitude granted by the starter on the lever's primary channel. */
  magnitude: number;
  maintenance?: number;
}

export interface OpsTreeDef {
  starter: OpsStarterDef;
  branches: [OpsBranchDef, OpsBranchDef, OpsBranchDef];
}

export const OPS_TREES: Record<UpgradeCategory, OpsTreeDef> = {
  fundraising: {
    starter: { funds: 50_000, actions: 10, effect: "+$35k/turn base income", magnitude: 35_000 },
    branches: [
      {
        key: "a",
        label: "Grassroots",
        effectType: "incomeFlat",
        description: "Small-dollar donor network — steady recurring income each turn.",
        tiers: [
          { level: 1, funds: 150_000, actions: 15, effect: "+$200k/turn", magnitude: 200_000 },
          { level: 2, funds: 500_000, actions: 22, effect: "+$700k/turn", magnitude: 700_000 },
          { level: 3, funds: 1_500_000, actions: 30, effect: "+$1.8M/turn", magnitude: 1_800_000 },
        ],
      },
      {
        key: "b",
        label: "Bundlers",
        effectType: "incomeLumpOnPurchase",
        description: "Major-donor bundling — a large one-time cash infusion when purchased.",
        tiers: [
          {
            level: 1,
            funds: 120_000,
            actions: 18,
            effect: "+$250k now",
            magnitude: 0,
            lumpSum: 250_000,
          },
          {
            level: 2,
            funds: 320_000,
            actions: 24,
            effect: "+$700k now",
            magnitude: 0,
            lumpSum: 700_000,
          },
          {
            level: 3,
            funds: 700_000,
            actions: 32,
            effect: "+$1.5M now",
            magnitude: 0,
            lumpSum: 1_500_000,
          },
        ],
      },
      {
        key: "c",
        label: "Direct Mail",
        effectType: "incomeMultiplier",
        description: "Mail-order donor drive that multiplies ALL campaign income.",
        tiers: [
          {
            level: 1,
            funds: 200_000,
            actions: 16,
            effect: "+15% income",
            magnitude: 0.15,
            maintenance: 8_000,
          },
          {
            level: 2,
            funds: 500_000,
            actions: 22,
            effect: "+35% income",
            magnitude: 0.35,
            maintenance: 20_000,
          },
          {
            level: 3,
            funds: 1_100_000,
            actions: 30,
            effect: "+60% income",
            magnitude: 0.6,
            maintenance: 40_000,
          },
        ],
      },
    ],
  },

  groundGame: {
    starter: {
      funds: 55_000,
      actions: 10,
      effect: "+3% in swing areas",
      magnitude: 3,
      maintenance: 5_500,
    },
    branches: [
      {
        key: "a",
        label: "Field Offices",
        effectType: "swingPct",
        description: "Boots on the ground where the race is decided — swing-area performance.",
        tiers: [
          {
            level: 1,
            funds: 110_000,
            actions: 15,
            effect: "+4% swing",
            magnitude: 4,
            maintenance: 12_000,
          },
          {
            level: 2,
            funds: 240_000,
            actions: 20,
            effect: "+8% swing",
            magnitude: 8,
            maintenance: 30_000,
          },
          {
            level: 3,
            funds: 500_000,
            actions: 26,
            effect: "+12% swing",
            magnitude: 12,
            maintenance: 60_000,
          },
        ],
      },
      {
        key: "b",
        label: "Get-Out-The-Vote",
        effectType: "gotvPct",
        description: "Turnout machine — a smaller boost across ALL areas, not just swing.",
        tiers: [
          {
            level: 1,
            funds: 130_000,
            actions: 16,
            effect: "+1.5% everywhere",
            magnitude: 1.5,
            maintenance: 10_000,
          },
          {
            level: 2,
            funds: 300_000,
            actions: 22,
            effect: "+3% everywhere",
            magnitude: 3,
            maintenance: 24_000,
          },
          {
            level: 3,
            funds: 650_000,
            actions: 30,
            effect: "+5% everywhere",
            magnitude: 5,
            maintenance: 50_000,
          },
        ],
      },
      {
        key: "c",
        label: "Volunteer Corps",
        effectType: "maintReductionPct",
        description: "Unpaid volunteers cut the ground game's ongoing upkeep.",
        tiers: [
          { level: 1, funds: 90_000, actions: 12, effect: "-15% upkeep", magnitude: 0.15 },
          { level: 2, funds: 200_000, actions: 16, effect: "-30% upkeep", magnitude: 0.3 },
          { level: 3, funds: 420_000, actions: 22, effect: "-50% upkeep", magnitude: 0.5 },
        ],
      },
    ],
  },

  mediaSpending: {
    starter: {
      funds: 60_000,
      actions: 12,
      effect: "+0.5%/turn favorability",
      magnitude: 0.5,
      maintenance: 6_000,
    },
    branches: [
      {
        key: "a",
        label: "Broadcast",
        effectType: "favPerTurn",
        description:
          "Radio, newsreel and press buys. The strongest favorability driver, higher upkeep.",
        tiers: [
          {
            level: 1,
            funds: 120_000,
            actions: 16,
            effect: "+0.5%/turn",
            magnitude: 0.5,
            maintenance: 14_000,
          },
          {
            level: 2,
            funds: 280_000,
            actions: 20,
            effect: "+1.0%/turn",
            magnitude: 1.0,
            maintenance: 34_000,
          },
          {
            level: 3,
            funds: 600_000,
            actions: 26,
            effect: "+1.5%/turn",
            magnitude: 1.5,
            maintenance: 70_000,
          },
        ],
      },
      {
        key: "b",
        label: "Television",
        effectType: "favPerTurn",
        description: "Televised spots and appearances. Cheaper favorability with lower upkeep.",
        tiers: [
          {
            level: 1,
            funds: 80_000,
            actions: 12,
            effect: "+0.3%/turn",
            magnitude: 0.3,
            maintenance: 5_000,
          },
          {
            level: 2,
            funds: 180_000,
            actions: 16,
            effect: "+0.6%/turn",
            magnitude: 0.6,
            maintenance: 12_000,
          },
          {
            level: 3,
            funds: 380_000,
            actions: 22,
            effect: "+1.0%/turn",
            magnitude: 1.0,
            maintenance: 26_000,
          },
        ],
      },
      {
        key: "c",
        label: "Rapid Response",
        effectType: "oppoShieldPct",
        description: "War room that blunts opponents' opposition research against you.",
        tiers: [
          {
            level: 1,
            funds: 100_000,
            actions: 14,
            effect: "-25% incoming oppo",
            magnitude: 0.25,
            maintenance: 8_000,
          },
          {
            level: 2,
            funds: 220_000,
            actions: 18,
            effect: "-50% incoming oppo",
            magnitude: 0.5,
            maintenance: 18_000,
          },
          {
            level: 3,
            funds: 460_000,
            actions: 24,
            effect: "-75% incoming oppo",
            magnitude: 0.75,
            maintenance: 38_000,
          },
        ],
      },
    ],
  },

  oppositionResearch: {
    starter: { funds: 40_000, actions: 8, effect: "-0.5%/turn to target", magnitude: 0.5 },
    branches: [
      {
        key: "a",
        label: "Dossier",
        effectType: "oppoFavPerTurn",
        description: "Sustained research — recurring favorability drain on your target.",
        tiers: [
          { level: 1, funds: 80_000, actions: 12, effect: "-0.5%/turn", magnitude: 0.5 },
          { level: 2, funds: 180_000, actions: 16, effect: "-1.0%/turn", magnitude: 1.0 },
          { level: 3, funds: 400_000, actions: 22, effect: "-1.5%/turn", magnitude: 1.5 },
        ],
      },
      {
        key: "b",
        label: "Scandal Leak",
        effectType: "oppoLumpOnPurchase",
        description: "Drop the story now — a one-time favorability hit to your current target.",
        tiers: [
          { level: 1, funds: 120_000, actions: 18, effect: "-2% now", magnitude: 0, lumpSum: 2 },
          { level: 2, funds: 300_000, actions: 26, effect: "-4% now", magnitude: 0, lumpSum: 4 },
          { level: 3, funds: 650_000, actions: 36, effect: "-7% now", magnitude: 0, lumpSum: 7 },
        ],
      },
      {
        key: "c",
        label: "Counter-Intel",
        effectType: "oppoAmpPct",
        description: "Sharper tradecraft — amplifies your recurring research drain.",
        tiers: [
          { level: 1, funds: 90_000, actions: 12, effect: "+20% research", magnitude: 0.2 },
          { level: 2, funds: 200_000, actions: 16, effect: "+40% research", magnitude: 0.4 },
          { level: 3, funds: 420_000, actions: 22, effect: "+70% research", magnitude: 0.7 },
        ],
      },
    ],
  },
};

/** Returns the branch definition for a lever + branch key, or null. */
export function getOpsBranch(category: UpgradeCategory, branch: OpsBranchKey): OpsBranchDef | null {
  return OPS_TREES[category].branches.find((b) => b.key === branch) ?? null;
}

/** Cumulative effect magnitude for a branch at a given level (0 at level 0). */
export function getOpsBranchMagnitude(
  category: UpgradeCategory,
  branch: OpsBranchKey,
  level: number
): number {
  if (level <= 0) return 0;
  const def = getOpsBranch(category, branch);
  const tier = def?.tiers.find((t) => t.level === level);
  return tier?.magnitude ?? 0;
}

/**
 * Fully-adjusted cost to buy the next tier of a branch (or the starter when
 * `branch` is null and the lever is not yet unlocked). Applies the same
 * per-race-family scalar and general-phase surcharge as `getEffectiveUpgradeCost`
 * so the UI preview and the server gate stay in lockstep. Returns null when the
 * branch is already maxed or the level is out of range.
 */
export function getEffectiveBranchCost(
  category: UpgradeCategory,
  branch: OpsBranchKey | null,
  nextLevel: number,
  electionType: string | undefined,
  isGeneralPhase: boolean
): {
  funds: number;
  actions: number;
  effect: string;
  maintenance?: number;
  lumpSum?: number;
} | null {
  const scalar = getCampaignFamilyScalar(electionType);
  const surge = isGeneralPhase ? GENERAL_PHASE_UPGRADE_MULTIPLIER : 1;
  if (branch === null) {
    const s = OPS_TREES[category].starter;
    return {
      funds: Math.ceil(Math.round(s.funds * scalar) * surge),
      actions: Math.ceil(s.actions * surge),
      effect: s.effect,
      maintenance: s.maintenance != null ? Math.round(s.maintenance * scalar) : undefined,
    };
  }
  const def = getOpsBranch(category, branch);
  const tier = def?.tiers.find((t) => t.level === nextLevel);
  if (!tier) return null;
  return {
    funds: Math.ceil(Math.round(tier.funds * scalar) * surge),
    actions: Math.ceil(tier.actions * surge),
    effect: tier.effect,
    maintenance: tier.maintenance != null ? Math.round(tier.maintenance * scalar) : undefined,
    lumpSum: tier.lumpSum != null ? Math.round(tier.lumpSum * scalar) : tier.lumpSum,
  };
}

/**
 * Total per-turn maintenance for a lever's current tree state, in anchor $
 * scaled by race family. Sums starter + each owned branch tier's maintenance,
 * then applies any `maintReductionPct` branch on the same lever.
 */
export function getTreeMaintenanceCost(
  category: UpgradeCategory,
  tree: { starter: boolean; a: number; b: number; c: number } | undefined,
  electionType?: string
): number {
  if (!tree?.starter) return 0;
  const def = OPS_TREES[category];
  let total = def.starter.maintenance ?? 0;
  let reduction = 0;
  for (const branchDef of def.branches) {
    const level = tree[branchDef.key];
    for (let i = 0; i < level; i++) {
      total += branchDef.tiers[i]?.maintenance ?? 0;
    }
    if (branchDef.effectType === "maintReductionPct" && level > 0) {
      reduction = branchDef.tiers[level - 1]?.magnitude ?? 0;
    }
  }
  total = total * (1 - reduction);
  const scalar = getCampaignFamilyScalar(electionType);
  return Math.round(total * scalar);
}

/**
 * Highest level achievable in each category. Mirrors the length of each
 * UPGRADE_COSTS array so caps stay in lockstep with the table above.
 */
export function getMaxLevel(category: UpgradeCategory): number {
  return UPGRADE_COSTS[category].length;
}

/**
 * Returns the upgrade cost for `category` at `level`. When `electionType`
 * is supplied, applies the per-race-family scalar from
 * `CAMPAIGN_FAMILY_SCALAR_BY_ELECTION_TYPE`. Backward-compat: no
 * scalar applied when electionType is undefined.
 */
export function getUpgradeCost(
  category: UpgradeCategory,
  level: number,
  electionType?: string
): UpgradeCost | null {
  const costs = UPGRADE_COSTS[category];
  const base = (costs as readonly UpgradeCost[]).find((c) => c.level === level);
  if (!base) return null;
  const scalar = getCampaignFamilyScalar(electionType);
  if (scalar === 1.0) return base;
  return {
    ...base,
    funds: Math.round(base.funds * scalar),
    maintenance: base.maintenance != null ? Math.round(base.maintenance * scalar) : undefined,
  };
}

/**
 * One-time upgrade surcharge applied while a race is in its general-election
 * phase (primary closed, election not yet ended). Multiplies the funds + actions
 * cost of buying the next level; recurring maintenance is unaffected.
 *
 * SSOT: the upgrade gate (`upgradeCampaign`) and every cost-preview surface
 * (`getEffectiveUpgradeCost`) read this same constant, so the displayed cost and
 * the charged cost never diverge.
 */
export const GENERAL_PHASE_UPGRADE_MULTIPLIER = 1.5;

/**
 * Returns the fully-adjusted cost to buy the next level of `category`, applying
 * BOTH the per-race-family budget scalar (via `getUpgradeCost`) and — when the
 * race is in its general-election phase — the `GENERAL_PHASE_UPGRADE_MULTIPLIER`
 * surcharge on funds and actions.
 *
 * This is the single source of truth for what an upgrade costs. The server gate
 * and the campaign UI both call it so the "Upgrade" button only enables when the
 * upgrade is genuinely affordable (previously the UI showed the un-surcharged
 * base cost in the general phase, enabling a button the gate then rejected with
 * "Insufficient funds").
 *
 * `maintenance` is deliberately NOT surcharged — it is a recurring per-turn cost
 * (see `getMaintenanceCost`), so the displayed figure matches what is charged
 * each turn rather than the one-time upgrade price.
 *
 * Returns null for an out-of-range level (mirrors `getUpgradeCost`).
 */
export function getEffectiveUpgradeCost(
  category: UpgradeCategory,
  level: number,
  electionType: string | undefined,
  isGeneralPhase: boolean
): UpgradeCost | null {
  const scaled = getUpgradeCost(category, level, electionType);
  if (!scaled) return null;
  if (!isGeneralPhase) return scaled;
  return {
    ...scaled,
    funds: Math.ceil(scaled.funds * GENERAL_PHASE_UPGRADE_MULTIPLIER),
    actions: Math.ceil(scaled.actions * GENERAL_PHASE_UPGRADE_MULTIPLIER),
  };
}

export function getMaintenanceCost(
  category: UpgradeCategory,
  level: number,
  electionType?: string
): number {
  if (level === 0) return 0;
  const costs = UPGRADE_COSTS[category];
  let total = 0;
  for (let i = 0; i < level; i++) {
    const cost = (costs as readonly UpgradeCost[])[i];
    if (cost?.maintenance) {
      total += cost.maintenance;
    }
  }
  const scalar = getCampaignFamilyScalar(electionType);
  return Math.round(total * scalar);
}
