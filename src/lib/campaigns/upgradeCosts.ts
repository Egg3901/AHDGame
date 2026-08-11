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
