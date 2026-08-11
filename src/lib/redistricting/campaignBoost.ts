export const CAMPAIGN_BOOST_CAP = 7.5;
export const CAMPAIGN_BOOST_DECAY = 0.5;
export const CAMPAIGN_BOOST_PER_ACTION = 2.5;
export const CAMPAIGN_SELF_EFFICIENCY = 1.0;
export const CAMPAIGN_ALLY_EFFICIENCY = 0.5;

/** Accumulate a boost toward the cap. */
export function applyCampaignBoost(current: number, delta: number): number {
  return Math.min(CAMPAIGN_BOOST_CAP, Math.max(0, current + delta));
}

/** Decay every boost by one turn; prune entries that hit 0. */
export function decayBoostMap(
  map: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [districtIndex, byParty] of Object.entries(map)) {
    const next: Record<string, number> = {};
    for (const [party, v] of Object.entries(byParty)) {
      const decayed = Math.max(0, v - CAMPAIGN_BOOST_DECAY);
      if (decayed > 0) next[party] = decayed;
    }
    if (Object.keys(next).length > 0) out[districtIndex] = next;
  }
  return out;
}
