/**
 * Fundraise costs FUNDRAISE_ACTION_COST action points and requires donors.
 * fundraiseYieldAnchor scales the yield with donor level, political influence,
 * and the fundraising stat. Hosts own currency conversion and persistence.
 *
 * Campaign costs tiered action points plus a GDP-scaled fund cost and gains
 * political influence with diminishing returns. quoteCampaignAction is the
 * single source of truth both the UI quote and execution call; missing stats
 * or missing home-state economics reject instead of falling back to neutral
 * values. Hosts own currency conversion, atomic resource checks and
 * persistence.
 */
import { statMultiplier } from "../stats/statMultiplier";
import { NEUTRAL_STAT } from "../stats/statsConstants";
import { getGdpBaseline } from "../utils/fundGeneration";

/** Action points charged per Fundraise use: flat at every donor level. */
export const FUNDRAISE_ACTION_COST = 3;

/**
 * Minimal fundraise actor. Structurally compatible with Character: pass a
 * Character wherever this is accepted. Characters that predate the stat
 * system omit `stats` and get the neutral fallback (1.0x multiplier).
 */
export interface FundraiseActor {
  donorBaseLevel: number;
  politicalInfluence?: number;
  stats?: { fundraising?: number };
}

/**
 * Per-use fundraising yield in ANCHOR units, before the fundraising stat
 * multiplier.
 * $50K floor + $2K per donor base level (calibrated for 0-75 range),
 * scaled by state influence multiplier (1.0x at 0% to 2.0x at 100%).
 * L0/0%: $50K, L50/50%: $225K, L75/100%: $400K.
 */
export function calculateFundraisingAmount(
  donorBaseLevel: number,
  stateInfluence?: number
): number {
  const base = 50_000 + donorBaseLevel * 2_000;
  if (stateInfluence === undefined) return base;
  const multiplier = 1 + Math.max(0, Math.min(100, stateInfluence)) / 100;
  return Math.round(base * multiplier);
}

/**
 * Canonical per-use Fundraise yield in ANCHOR units, including the fundraising
 * stat multiplier. The single source of truth: the Fundraise action effect
 * and every UI that quotes the yield must call this, or the quote and the
 * credit drift apart (ticket 1107).
 */
export function fundraiseYieldAnchor(actor: FundraiseActor): number {
  const base = calculateFundraisingAmount(actor.donorBaseLevel, actor.politicalInfluence ?? 0);
  const stat = actor.stats?.fundraising ?? NEUTRAL_STAT;
  return Math.round(base * statMultiplier(stat));
}

/**
 * Fundraise eligibility: fundraising requires an established donor base, so
 * donor level zero is ineligible. Mirrors the execute gate exactly.
 */
export function isFundraiseEligible(donorBaseLevel?: number | null): boolean {
  return (donorBaseLevel ?? 0) !== 0;
}

// ── Campaign (Game1724 slice 2) ─────────────────────────────────────────────
// Cost, eligibility and effect math moved verbatim from `../actions` so the UI
// quote, the execute shell and NPP callers share one implementation. Balance
// is unchanged: the numbers below are the historical formulas, only the owner
// moved. The strict entry point is quoteCampaignAction; the lenient wrappers
// (getCampaignActionCost/getCampaignFundCost/campaignInfluenceGain) stay for
// AP-only and NPP callers that never had stat/target context.

/** Base campaign fund cost before tier/GDP scaling, in ANCHOR units. */
export const CAMPAIGN_BASE_FUND_COST = 20_000;

/** Political influence cap: campaigning at 100% is ineligible. */
export const CAMPAIGN_MAX_INFLUENCE = 100;

/**
 * Shared fund-cost multiplier for actions that spend money.
 * multiplier = (1 + tier × 0.2) × gdpScalar
 * gdpScalar = clamp(gdpPerCapita / countryBaseline, 0.85, 2.0)
 * gdpMillions: state GDP stored in millions (e.g. 289_500 = $289.5B)
 */
export function getFundMultiplier(
  tier: number,
  gdpMillions: number,
  population: number,
  countryId = "US"
): number {
  const baseline = getGdpBaseline(countryId);
  const gdpPerCapita = (gdpMillions * 1_000_000) / population;
  const gdpScalar = Math.max(0.85, Math.min(2.0, gdpPerCapita / baseline));
  return (1 + tier * 0.2) * gdpScalar;
}

/**
 * Tiered action-point cost for the Campaign action (raise state PI).
 * Tier 1–5 based on current state political influence.
 */
export function getCampaignActionCost(influence: number): number {
  const clampedInfluence = Math.max(0, Math.min(100, influence));
  if (clampedInfluence >= 80) return 5;
  if (clampedInfluence >= 60) return 4;
  if (clampedInfluence >= 40) return 3;
  if (clampedInfluence >= 20) return 2;
  return 1;
}

/**
 * Fund cost for the Campaign action.
 * Base $20,000 × tier, scaled by state GDP per capita relative to country baseline.
 * GDP is stored in millions of dollars (e.g. CT = 289,500 → $289.5B).
 */
export function getCampaignFundCost(
  influence: number,
  stateGdpMillions: number,
  statePopulation: number,
  countryId = "US"
): number {
  const tier = getCampaignActionCost(influence); // 1-5
  const multiplier = getFundMultiplier(tier - 1, stateGdpMillions, statePopulation, countryId);
  return Math.round((CAMPAIGN_BASE_FUND_COST * tier * multiplier) / 1_000) * 1_000;
}

/**
 * Base political-influence gain for one "Campaign" action, before stat scaling.
 * Shared by player actions and NPP turn processing.
 *
 * Base +1, penalized above 50 at 1/75 of the excess, floored at 0.1 so
 * campaigning is never fully wasted. Against the proportional influence decay
 * this converges a hard-campaigning character near ~80, not the 100 cap.
 */
export function campaignInfluenceGain(currentInfluence: number, effectivenessMult = 1): number {
  const baseGain = 1;
  const threshold = 50;
  const rate = 1 / 75;
  const penalty = currentInfluence > threshold ? (currentInfluence - threshold) * rate : 0;
  return Math.max(0.1, (baseGain - penalty) * effectivenessMult);
}

/**
 * Campaign eligibility: influence at the 100% cap cannot campaign further.
 * Mirrors the execute gate exactly.
 */
export function isCampaignEligible(influence: number): boolean {
  return influence < CAMPAIGN_MAX_INFLUENCE;
}

/**
 * Raw campaign actor inputs, preserved explicitly. Stat fields arrive as the
 * stored raw values (or missing for characters that predate the stat system);
 * the rules own the statMultiplier interpretation and reject missing stats
 * instead of substituting the neutral fallback.
 */
export interface CampaignQuoteActor {
  politicalInfluence?: number | null;
  charisma?: number | null;
  intellect?: number | null;
}

/**
 * Raw campaign target inputs, preserved explicitly. The state GDP, population
 * and country currency basis arrive as stored; the rules own the GDP-scalar
 * interpretation and reject a missing target instead of substituting the flat
 * fallback cost.
 */
export interface CampaignQuoteTarget {
  gdpMillions?: number | null;
  population?: number | null;
  countryId?: string | null;
}

/**
 * Authoritative campaign quote: tiered AP cost, GDP-scaled fund cost in ANCHOR
 * units (after the intellect cost-curve hook), and the charisma-scaled
 * influence gain. Invalid, maxed or incomplete inputs reject with a typed
 * error the shell surfaces; they never silently resolve to neutral values.
 */
export type CampaignQuote =
  | { ok: true; apCost: number; fundCostAnchor: number; influenceGain: number }
  | { ok: false; error: string };

export function quoteCampaignAction(
  actor: CampaignQuoteActor,
  target?: CampaignQuoteTarget | null
): CampaignQuote {
  const influence = actor.politicalInfluence;
  if (typeof influence !== "number" || !Number.isFinite(influence)) {
    return { ok: false, error: "Campaign requires a political influence value." };
  }
  if (!isCampaignEligible(influence)) {
    return {
      ok: false,
      error: "Your political influence is already at maximum (100%).",
    };
  }
  const { charisma, intellect } = actor;
  if (typeof charisma !== "number" || !Number.isFinite(charisma)) {
    return {
      ok: false,
      error:
        "Campaign requires an allocated charisma stat. Allocate your stats before campaigning.",
    };
  }
  if (typeof intellect !== "number" || !Number.isFinite(intellect)) {
    return {
      ok: false,
      error:
        "Campaign requires an allocated intellect stat. Allocate your stats before campaigning.",
    };
  }
  if (!target) {
    return {
      ok: false,
      error: "Campaign requires home-state economic data (GDP and population).",
    };
  }
  const { gdpMillions, population, countryId } = target;
  if (typeof gdpMillions !== "number" || !Number.isFinite(gdpMillions) || gdpMillions < 0) {
    return {
      ok: false,
      error: "Campaign requires home-state economic data (GDP and population).",
    };
  }
  if (typeof population !== "number" || !Number.isFinite(population) || population <= 0) {
    return {
      ok: false,
      error: "Campaign requires home-state economic data (GDP and population).",
    };
  }
  if (typeof countryId !== "string" || countryId.length === 0) {
    return { ok: false, error: "Campaign requires a country currency basis." };
  }
  // Intellect softens the campaign cost-scaling curve (higher → cheaper).
  const fundCostAnchor = Math.round(
    getCampaignFundCost(influence, gdpMillions, population, countryId) / statMultiplier(intellect)
  );
  // Charisma scales the diminishing-returns gain (gentle ±20%).
  const influenceGain = campaignInfluenceGain(influence, statMultiplier(charisma));
  return { ok: true, apCost: getCampaignActionCost(influence), fundCostAnchor, influenceGain };
}
