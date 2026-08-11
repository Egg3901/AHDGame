/**
 * NPP Recruitment helper functions for calculating slots and costs.
 */

export interface RecruitmentSlotTier {
  /** Minimum state organization (inclusive, percent) to qualify for this tier. */
  minOrg: number;
  /** Maximum NPP recruitment slots granted at this tier. */
  slots: number;
}

/**
 * Per-state NPP recruitment slot tiers, ascending by org threshold. A party's
 * cap in a state is the slots of the highest tier whose `minOrg` the state's
 * organization meets or exceeds. The first tier (2 slots) is the always-available
 * floor; the last tier (5 slots) is the total cap.
 *
 * Exported so UI surfaces can render the same tier table without duplicating the
 * thresholds — this array is the single source of truth for the cap curve.
 */
export const RECRUITMENT_SLOT_TIERS: readonly RecruitmentSlotTier[] = [
  { minOrg: 0, slots: 2 },
  { minOrg: 30, slots: 3 },
  { minOrg: 40, slots: 4 },
  { minOrg: 50, slots: 5 },
];

/**
 * Calculate the maximum NPP recruitment slots for a party in a state, based on
 * that party's current organization there. The cap is re-evaluated from live org
 * on every recruit attempt, so a state that drops below a tier keeps any NPPs it
 * already recruited (they are never retired) but those NPPs still count against
 * the cap if org later climbs back.
 */
export function calculateRecruitmentSlots(stateOrg: number): number {
  let slots = RECRUITMENT_SLOT_TIERS[0].slots;
  for (const tier of RECRUITMENT_SLOT_TIERS) {
    if (stateOrg >= tier.minOrg) slots = tier.slots;
  }
  return slots;
}

/**
 * How far above a party's fair national share of NPPs a single region may be
 * stacked by relocation. 1.5 leaves room for a real strategy (concentrating
 * talent in a battleground) while still refusing "move the entire party into one
 * region".
 */
export const RELOCATION_FAIR_SHARE_MULTIPLIER = 1.5;

/**
 * Maximum NPPs of one party a region may hold *as a relocation target*.
 *
 * This is deliberately NOT `calculateRecruitmentSlots`. Recruitment slots cap
 * party *growth* — creating a brand-new NPP — and top out at 5 per region. A
 * relocation creates nobody: it is net-zero nationally. Applying the growth cap
 * to it made relocation impossible in every country with a seeded roster, where
 * one region routinely holds dozens of a party's NPPs and so reads as "full"
 * before the player does anything (the UK 1953 sandbox: every region full, so
 * every target in the picker was disabled).
 *
 * The relocation cap is therefore the greater of the recruitment cap and the
 * party's fair national share of its own roster, scaled by
 * `RELOCATION_FAIR_SHARE_MULTIPLIER`. Small parties keep the familiar 2-5 slot
 * behaviour; large seeded parties get a cap that scales with the roster they
 * actually have.
 *
 * @param targetStateOrg - the party's organization in the target region (percent)
 * @param partyNppCount - the party's total active NPPs in the country
 * @param regionCount - number of regions in the country
 */
export function calculateRelocationCapacity(
  targetStateOrg: number,
  partyNppCount: number,
  regionCount: number
): number {
  const recruitmentCap = calculateRecruitmentSlots(targetStateOrg);
  const regions = Math.max(1, regionCount);
  const fairShare = Math.ceil((partyNppCount / regions) * RELOCATION_FAIR_SHARE_MULTIPLIER);
  return Math.max(recruitmentCap, fairShare);
}

const BASE_COSTS: { actions: number; funds: number }[] = [
  { actions: 5, funds: 100000 }, // 0 NPPs in state
  { actions: 8, funds: 200000 }, // 1 NPP
  { actions: 12, funds: 350000 }, // 2 NPPs
  { actions: 18, funds: 600000 }, // 3 NPPs
  { actions: 25, funds: 1000000 }, // 4+ NPPs
];

/**
 * Calculate recruitment cost based on state NPP count and party-wide NPP count.
 */
export function calculateRecruitmentCost(
  stateNPPCount: number,
  partyNPPCount: number
): { actions: number; funds: number } {
  const tier = Math.min(stateNPPCount, 4);
  const base = BASE_COSTS[tier];

  const actionMod = Math.min(5, Math.floor(partyNPPCount / 20));
  const fundModPercent = Math.min(100, Math.floor(partyNPPCount / 20) * 10);

  return {
    actions: base.actions + actionMod,
    funds: Math.round(base.funds * (1 + fundModPercent / 100)),
  };
}

/**
 * Calculate the cost to persuade an existing NPP to relocate into a target
 * state. This is intentionally cheaper than creating a brand-new NPP in that
 * state, but it still scales off the same scarcity curve.
 */
export function calculateRelocationRequestCost(
  targetStateNPPCount: number,
  partyNPPCount: number
): { actions: number; funds: number } {
  const recruitCost = calculateRecruitmentCost(targetStateNPPCount, partyNPPCount);
  return {
    actions: Math.max(1, Math.ceil(recruitCost.actions * 0.25)),
    funds: Math.max(1, Math.ceil(recruitCost.funds * 0.25)),
  };
}

/**
 * Get party-wide cost modifiers based on total party NPP count.
 */
export function getPartyModifiers(partyNPPCount: number): {
  actionModifier: number;
  fundModifierPercent: number;
} {
  return {
    actionModifier: Math.min(5, Math.floor(partyNPPCount / 20)),
    fundModifierPercent: Math.min(100, Math.floor(partyNPPCount / 20) * 10),
  };
}
