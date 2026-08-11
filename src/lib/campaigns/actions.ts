/**
 * Per-turn campaign action gain for the campaign manager's SEPARATE action pool
 * (distinct from the player's Character.actions pool — upgrades + ops spend from
 * Campaign.actions, never from the player).
 *
 * Formula: baseline + floor(sqrt(endorsementCount) * 3)
 *
 * The baseline comes from the player's own base action gain (baseActionsPerTurn
 * from game config) so a more active player rolls a correspondingly more active
 * campaign. Endorsements ONLY boost campaign actions — never the player pool.
 */
export function calculateCampaignActions(endorsementCount: number, baseline: number = 1): number {
  const safeBaseline = Number.isFinite(baseline) && baseline > 0 ? Math.floor(baseline) : 1;
  if (endorsementCount < 0 || !Number.isFinite(endorsementCount)) {
    return safeBaseline;
  }
  return safeBaseline + Math.floor(Math.sqrt(endorsementCount) * 3);
}
