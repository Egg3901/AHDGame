/**
 * Shared campaign-strength vote multiplier.
 *
 * Campaign strength should matter, but it should not become the whole election.
 * This curve keeps CS meaningful while soft-capping the total vote boost at
 * +100%, and the per-turn pullback prevents one runaway leader from permanently
 * locking in an old overpowered CS lead.
 */
export const CAMPAIGN_STRENGTH_MAX_BONUS = 1;
export const CAMPAIGN_STRENGTH_TAU = 50_000;
export const CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER = 0.75;
export const CAMPAIGN_STRENGTH_LEADER_PULLBACK_MAX_PER_TURN = 175;

/**
 * Campaign-fund price of ONE point of campaign strength, in anchor currency,
 * before the saturation surcharge below. Callers convert to the player's local
 * campaign-fund balance with `campaignLocalRate`.
 *
 * Calibrated against the presidential campaign economy rather than against the
 * old price: fundraising runs $20k/turn at L0 to $5M/turn at L10, L10 alone
 * costs $10M, and the full four-category upgrade tree is ~$31M plus
 * maintenance. Campaign strength is a up-to-+100% vote multiplier, so
 * saturating it is priced ABOVE the whole upgrade tree — ~$50M — making it an
 * aspirational commitment for a dominant campaign rather than routine spend.
 */
export const CAMPAIGN_STRENGTH_PRICE_PER_POINT = 83;

/**
 * Campaign strength bought per action spent. A contribution's action cost is
 * `ceil(strengthAdded / this)`, so the action price per POINT of CS is the same
 * for everyone; national influence buys fewer, larger clicks rather than a
 * cheaper total.
 */
export const CAMPAIGN_STRENGTH_POINTS_PER_ACTION = 300;

/**
 * Cost (anchor currency) of contributing `strengthAdded` points of campaign
 * strength to a campaign that currently sits at `currentStrength`.
 *
 * The old formula was `sqrt(currentStrength + strengthAdded)` — charged PER
 * CLICK and blind to how much that click bought. Because a click's yield is
 * `nationalInfluence * 0.75`, the price per point of CS scaled inversely with
 * influence: reaching the ~150k CS that saturates the vote bonus cost roughly
 * 12,900 CF at 4,000 NPI but 516,000 CF at 100 NPI, for the identical result.
 * The whole mechanic was also far too cheap in absolute terms.
 *
 * The replacement prices the QUANTITY bought, with a QUADRATIC saturation
 * surcharge keyed to CAMPAIGN_STRENGTH_TAU. The marginal price of a point of CS
 * is
 *
 *   dPrice/dCS = PRICE_PER_POINT * (1 + (CS / TAU)^2)
 *
 * so staying competitive is affordable but saturating the +100% bonus is not:
 * the per-point price is 1x at 0 CS, 2x at TAU, 5x at 2*TAU and 10x at 3*TAU.
 * That is deliberately harsher than a linear surcharge, because late CS does
 * the least marginal work on the vote curve while being the most decisive.
 *
 * The cost of a purchase is the EXACT integral of that marginal price across
 * [current, current + added]:
 *
 *   price = PRICE_PER_POINT * (added + ((current + added)^3 - current^3)
 *                                      / (3 * TAU^2))
 *
 * Using the exact integral rather than sampling the curve at the purchase
 * midpoint matters here: for a quadratic the midpoint rule undercharges by
 * `added^3 / (12 * TAU^2)`, an error that grows with the step size and would
 * quietly hand large-step (high national influence) buyers a discount — the
 * very asymmetry this rewrite exists to remove. With the exact form the total
 * cost of reaching a given CS is `PRICE_PER_POINT * (S + S^3 / (3 * TAU^2))`
 * regardless of how it is split into clicks; at S = 150,000 that is ~49.8M CF
 * for every player, against a ~31M full upgrade tree.
 */
export function campaignStrengthContributionCost(
  currentStrength: number | null | undefined,
  strengthAdded: number
): number {
  const current = Math.max(0, currentStrength ?? 0);
  const added = Math.max(0, strengthAdded);
  if (added === 0) return 0;
  const end = current + added;
  const cubicTerm =
    (end * end * end - current * current * current) /
    (3 * CAMPAIGN_STRENGTH_TAU * CAMPAIGN_STRENGTH_TAU);
  return CAMPAIGN_STRENGTH_PRICE_PER_POINT * (added + cubicTerm);
}

/**
 * Action cost of contributing `strengthAdded` points of campaign strength.
 * Always at least 1 so a trickle of influence still costs something.
 */
export function campaignStrengthContributionActions(strengthAdded: number): number {
  const added = Math.max(0, strengthAdded);
  if (added <= 0) return 0;
  return Math.max(1, Math.ceil(added / CAMPAIGN_STRENGTH_POINTS_PER_ACTION));
}

export interface CampaignStrengthPullbackCandidate {
  id: string;
  electionId: string;
  campaignStrength?: number | null;
  status?: string | null;
}

export function campaignStrengthVoteMultiplier(
  campaignStrength: number | null | undefined,
  /**
   * Asymptotic bonus cap, supplied by the race's frozen presidential ruleset
   * (elections/presidentialRuleset.ts). Defaults to the live constant so
   * non-presidential callers and legacy races are unchanged.
   */
  maxBonus: number = CAMPAIGN_STRENGTH_MAX_BONUS
): number {
  const strength = Math.max(0, campaignStrength ?? 0);
  if (strength === 0) return 1;
  return 1 + maxBonus * (1 - Math.exp(-strength / CAMPAIGN_STRENGTH_TAU));
}

export function campaignStrengthBoostPercent(campaignStrength: number | null | undefined): number {
  return (campaignStrengthVoteMultiplier(campaignStrength) - 1) * 100;
}

export function calculateCampaignStrengthLeaderPullbacks(
  campaigns: CampaignStrengthPullbackCandidate[],
  maxPullback = CAMPAIGN_STRENGTH_LEADER_PULLBACK_MAX_PER_TURN
): Map<string, number> {
  const pullbacks = new Map<string, number>();
  const activeByElection = new Map<string, CampaignStrengthPullbackCandidate[]>();

  for (const campaign of campaigns) {
    if (campaign.status === "archived") continue;
    const electionCampaigns = activeByElection.get(campaign.electionId) ?? [];
    electionCampaigns.push(campaign);
    activeByElection.set(campaign.electionId, electionCampaigns);
  }

  for (const electionCampaigns of activeByElection.values()) {
    if (electionCampaigns.length < 2) continue;

    let totalStrength = 0;
    let leader: CampaignStrengthPullbackCandidate | null = null;
    let leaderStrength = 0;
    let secondStrength = 0;

    for (const campaign of electionCampaigns) {
      const strength = Math.max(0, campaign.campaignStrength ?? 0);
      totalStrength += strength;

      if (!leader || strength > leaderStrength) {
        secondStrength = leaderStrength;
        leader = campaign;
        leaderStrength = strength;
      } else if (strength > secondStrength) {
        secondStrength = strength;
      }
    }

    if (!leader || leaderStrength <= 0 || leaderStrength <= secondStrength) continue;

    const averageStrength = totalStrength / electionCampaigns.length;
    const aboveAverage = leaderStrength - averageStrength;
    if (aboveAverage <= 0) continue;

    pullbacks.set(leader.id, Math.min(maxPullback, aboveAverage));
  }

  return pullbacks;
}
