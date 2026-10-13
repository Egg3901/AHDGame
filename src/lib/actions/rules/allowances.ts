/**
 * Player action allowances grant 25% more actions from personal and role sources.
 * Whole-action daily pools round up; personal and banked pools retain quarters.
 * The hoard tax rises with the base grant to preserve idle stockpiling pressure.
 */
export const PLAYER_ACTION_ALLOWANCE_MULTIPLIER = 1.25;
export const PLAYER_BASE_ACTION_GAIN = 5;
export const PLAYER_ACTION_HOARD_PENALTY = 5;

/** Convert an authored allowance to the amount a player actually receives. */
export function playerActionAllowance(authored: number): number {
  return authored * PLAYER_ACTION_ALLOWANCE_MULTIPLIER;
}

/** Personal base gain, including legacy configs and missing configuration. */
export function playerBaseActionGain(configured?: number): number {
  const authored = Number.isFinite(configured) ? Math.max(4, configured ?? 4) : 4;
  return playerActionAllowance(authored);
}

/** Small daily pools must grant whole spendable actions before their next reset. */
export function wholePlayerActionAllowance(authored: number): number {
  return Math.ceil(playerActionAllowance(authored));
}

/** Human campaign budgets receive the uplift; NPC campaign budgets retain their tuning. */
export function campaignActionAllowance(authored: number, candidateIsNPP: boolean): number {
  return candidateIsNPP ? authored : Math.round(playerActionAllowance(authored));
}

/** Apply a normal personal refresh without allowing an idle baseline bank to grow forever. */
export function refreshPersonalActionBank(
  actions: number,
  gain: number,
  cap: number,
  hoardThreshold: number
): number {
  const penalty = actions > hoardThreshold ? PLAYER_ACTION_HOARD_PENALTY : 0;
  return Math.min(cap, Math.max(0, actions - penalty + gain));
}

/** Party influence grants the same proportional increase as personal sources. */
export function partyActionAllowance(
  myInfluence: number,
  totalInfluence: number,
  totalPool: number,
  closeness: number,
  maxBonus: number
): number {
  if (totalInfluence === 0) return 0;
  const share = (myInfluence / totalInfluence) * totalPool;
  return playerActionAllowance(Math.min(maxBonus, Math.floor(share * closeness)));
}
