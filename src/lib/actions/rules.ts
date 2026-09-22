/**
 * Fundraise costs FUNDRAISE_ACTION_COST action points and requires donors.
 * fundraiseYieldAnchor scales the yield with donor level, political influence,
 * and the fundraising stat. Hosts own currency conversion and persistence.
 *
 * Campaign costs tiered action points plus a GDP-scaled fund cost and gains
 * political influence with diminishing returns. quoteCampaignAction is the
 * single source of truth both the UI quote and execution call; missing stats
 * or missing home-state economics reject instead of falling back to neutral
 * values.
 *
 * Advertise costs tiered action points plus a GDP-scaled fund cost and gains
 * favorability with diminishing returns. quoteAdvertiseAction is the single
 * source of truth both the UI quote and execution call; missing stats or
 * missing home-state economics reject instead of falling back to neutral
 * values. Hosts own currency conversion, atomic resource checks and
 * persistence.
 *
 * BuildDonorBase costs level-scaled action points plus a GDP-scaled fund cost
 * (discounted by the fundraising stat) and gains one donor level.
 * quoteBuildDonorBaseAction is the single source of truth both the UI quote
 * and execution call; missing stats or missing home-state economics reject
 * instead of falling back to neutral values.
 *
 * ConvertCash costs flat action points and converts personal cash to campaign
 * funds at a fixed rate with amount-scaled infamy. quoteConvertCashAction is
 * the single source of truth the default effect, the execute shell, the AI
 * advisor and the UI previews call; a missing or non-positive amount rejects
 * with a typed reason instead of pricing zero.
 *
 * Polls cost flat action points plus an intellect-scaled fund cost.
 * quotePollAction is the single source of truth the poll API route (quote,
 * affordability and atomic debit), the poll page display, the action effect
 * and canPerformAction all call; a missing intellect stat rejects instead of
 * falling back to the unscaled base. Hosts own currency conversion, atomic
 * resource checks and persistence.
 *
 * Rest costs zero action points, spends no funds and is always eligible.
 * quoteRestAction is the single source of truth the action effect,
 * canPerformAction, the turn dashboard cost map and the AI advisor call;
 * it has no actor, target, flag, cap, rounding or error cases. Hosts own
 * AP charging and persistence.
 *
 * Fundraise costs flat action points and credits the stat-scaled donor yield
 * with no fund cost. quoteFundraiseAction is the single source of truth the
 * action effect, canPerformAction, the UI card, the AI advisor and the
 * client-status projection call; a zero donor base rejects with the execute
 * reason instead of pricing a yield that cannot be earned. Missing influence
 * or stats keep the historical neutral fallbacks the effect always applied,
 * so pre-stat characters quote exactly what they are credited.
 *
 * Debate Prep costs flat action points for a fixed chance to +1 the Debate
 * skill. quoteDebatePrepAction is the single source of truth the execute
 * shell (eligibility gate), canPerformAction, the action definition and the
 * UI card all call; a disabled stat system or missing stat block rejects
 * instead of charging for a roll that cannot land. The roll itself stays in
 * `../stats/debatePrep` (injected rng, already pure); the quote owns the
 * chance constant both sides compare against. Hosts own the rng, the flag
 * read and persistence.
 *
 * Era price level (#2119): every money quote and fund-cost helper below takes a
 * trailing `priceLevel` scalar — the between-era deflator resolved at the SHELL
 * boundary (`campaigns/rules/priceLevel.ts` + `gameConfig.campaignEraPriceLevelEnabled`)
 * — and multiplies it into the anchor result. It defaults to 1, so omitting it
 * (every pre-#2119 caller) is byte-identical to today; the pure formulas never
 * read the flag themselves.
 */
import { statMultiplier } from "../stats/statMultiplier";
import {
  NEUTRAL_STAT,
  DEBATE_PREP_ACTION_COST,
  DEBATE_PREP_SUCCESS_CHANCE,
  STAT_MAX,
} from "../stats/statsConstants";
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
 *
 * `priceLevel` (issue #2119) is the between-era deflator resolved at the shell
 * from the world's era; it defaults to 1, so a caller that omits it — every
 * pre-#2119 call site — gets today's arithmetic byte-for-byte.
 */
export function calculateFundraisingAmount(
  donorBaseLevel: number,
  stateInfluence?: number,
  priceLevel = 1
): number {
  const base = 50_000 + donorBaseLevel * 2_000;
  if (stateInfluence === undefined) return Math.round(base * priceLevel);
  const multiplier = 1 + Math.max(0, Math.min(100, stateInfluence)) / 100;
  return Math.round(base * multiplier * priceLevel);
}

/**
 * Canonical per-use Fundraise yield in ANCHOR units, including the fundraising
 * stat multiplier. The single source of truth: the Fundraise action effect
 * and every UI that quotes the yield must call this, or the quote and the
 * credit drift apart (ticket 1107).
 *
 * `priceLevel` (issue #2119): the shell passes the world-era price level so a
 * 1953 world's yield deflates with its costs. Omitted/1 is today's behavior.
 */
export function fundraiseYieldAnchor(actor: FundraiseActor, priceLevel = 1): number {
  const base = calculateFundraisingAmount(
    actor.donorBaseLevel,
    actor.politicalInfluence ?? 0,
    priceLevel
  );
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

// ── Advertise (Game1724 slice) ──────────────────────────────────────────────
// Cost and effect math moved verbatim from `../actions` so the UI quote, the
// execute shell and NPP callers share one implementation. Balance is
// unchanged: the numbers below are the historical formulas, only the owner
// moved. The strict entry point is quoteAdvertiseAction; the lenient wrappers
// (getAdvertiseActionCost/getAdvertiseFundCost/advertiseFavorabilityGain) stay
// for AP-only and NPP callers that never had stat/target context.
// getFundMultiplier below is shared by both slices (one implementation).

/** Base advertise fund cost before tier/GDP scaling, in ANCHOR units. */
export const ADVERTISE_BASE_FUND_COST = 100_000;

/**
 * Shared fund-cost multiplier for actions that spend money.
 * multiplier = (1 + tier × 0.2) × gdpScalar × priceLevel
 * gdpScalar = clamp(gdpPerCapita / countryBaseline, 0.85, 2.0)
 * gdpMillions: state GDP stored in millions (e.g. 289_500 = $289.5B)
 *
 * `priceLevel` (issue #2119) is the between-era deflator resolved at the shell
 * from the world's era; it defaults to 1 so every pre-#2119 call site is
 * unchanged. Passing 1 explicitly is identical to omitting it.
 */
export function getFundMultiplier(
  tier: number,
  gdpMillions: number,
  population: number,
  countryId = "US",
  // Optional (never defaulted): callers with no world pass nothing and get the
  // modern-era baseline; runtime money paths pass the world's gameState.preset.
  preset?: string,
  // Optional (never defaulted): the resolved era price level; 1 = modern.
  priceLevel = 1
): number {
  const baseline = getGdpBaseline(countryId, preset);
  const gdpPerCapita = (gdpMillions * 1_000_000) / population;
  const gdpScalar = Math.max(0.85, Math.min(2.0, gdpPerCapita / baseline));
  return (1 + tier * 0.2) * gdpScalar * priceLevel;
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
 * Tiered action-point cost for the Advertise action.
 * Tier based on current favorability (0–100).
 */
export function getAdvertiseActionCost(favorability: number): number {
  const clampedFavorability = Math.max(0, Math.min(100, favorability));
  if (clampedFavorability >= 85) return 9;
  if (clampedFavorability >= 70) return 8;
  if (clampedFavorability >= 50) return 7;
  if (clampedFavorability >= 30) return 6;
  return 5;
}

/**
 * Fund cost for the Campaign action.
 * Base $20,000 × tier, scaled by state GDP per capita relative to country baseline
 * and (when threaded) the world-era price level (#2119).
 * GDP is stored in millions of dollars (e.g. CT = 289,500 → $289.5B).
 */
export function getCampaignFundCost(
  influence: number,
  stateGdpMillions: number,
  statePopulation: number,
  countryId = "US",
  // Optional (never defaulted): see getFundMultiplier.
  preset?: string,
  // Optional (never defaulted): resolved era price level; 1 = modern.
  priceLevel = 1
): number {
  const tier = getCampaignActionCost(influence); // 1-5
  const multiplier = getFundMultiplier(
    tier - 1,
    stateGdpMillions,
    statePopulation,
    countryId,
    preset,
    priceLevel
  );
  return Math.round((CAMPAIGN_BASE_FUND_COST * tier * multiplier) / 1_000) * 1_000;
}

/**
 * Fund cost for the Advertise action.
 * Base $100,000 scaled by favorability tier, state GDP per capita and (when
 * threaded) the world-era price level (#2119).
 */
export function getAdvertiseFundCost(
  favorability: number,
  stateGdpMillions: number,
  statePopulation: number,
  countryId = "US",
  // Optional (never defaulted): see getFundMultiplier.
  preset?: string,
  // Optional (never defaulted): resolved era price level; 1 = modern.
  priceLevel = 1
): number {
  const tier = getAdvertiseActionCost(favorability) - 5; // tier index 0-4
  const multiplier = getFundMultiplier(
    tier,
    stateGdpMillions,
    statePopulation,
    countryId,
    preset,
    priceLevel
  );
  return Math.round((ADVERTISE_BASE_FUND_COST * multiplier) / 1_000) * 1_000;
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
 * Base favorability gain for one "Run Advertisements" action, before stat
 * scaling. Shared by player actions and NPP turn processing so the two stay at
 * parity: base +3, diminishing returns above 70% favorability (−0.1 per point
 * over 70), floored at 1 so an ad is never fully wasted. `effectivenessMult`
 * carries the player's charisma multiplier; NPPs pass the default 1.
 */
export function advertiseFavorabilityGain(
  currentFavorability: number,
  effectivenessMult = 1
): number {
  const baseGain = 3;
  const penalty = currentFavorability > 70 ? (currentFavorability - 70) * 0.1 : 0;
  return Math.max(1, Math.floor((baseGain - penalty) * effectivenessMult));
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
  /**
   * World reset preset selecting the GDP-baseline era. Absent (client previews
   * that have no world to ask) the modern-era baseline applies; runtime callers
   * pass the world's `gameState.preset`.
   */
  preset?: string | null;
}

/**
 * Raw advertise actor inputs, preserved explicitly. The favorability and the
 * stored raw charisma arrive as-is (or missing for characters that predate
 * the stat system); the rules own the statMultiplier interpretation and
 * reject a missing stat instead of substituting the neutral fallback.
 */
export interface AdvertiseQuoteActor {
  favorability?: number | null;
  charisma?: number | null;
}

/**
 * Raw advertise target inputs, preserved explicitly. The state GDP,
 * population and country currency basis arrive as stored; the rules own the
 * GDP-scalar interpretation and reject a missing target instead of
 * substituting the unscaled tier fallback.
 */
export interface AdvertiseQuoteTarget {
  gdpMillions?: number | null;
  population?: number | null;
  countryId?: string | null;
  /**
   * World reset preset selecting the GDP-baseline era. Absent (client previews
   * that have no world to ask) the modern-era baseline applies; runtime callers
   * pass the world's `gameState.preset`.
   */
  preset?: string | null;
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
  target?: CampaignQuoteTarget | null,
  // Optional (never defaulted): the resolved era price level from the shell
  // (#2119); 1 = modern, byte-identical to today.
  priceLevel = 1
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
  const preset = target.preset ?? undefined;
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
    getCampaignFundCost(influence, gdpMillions, population, countryId, preset, priceLevel) /
      statMultiplier(intellect)
  );
  // Charisma scales the diminishing-returns gain (gentle ±20%).
  const influenceGain = campaignInfluenceGain(influence, statMultiplier(charisma));
  return { ok: true, apCost: getCampaignActionCost(influence), fundCostAnchor, influenceGain };
}

/**
 * Authoritative advertise quote: tiered AP cost, GDP-scaled fund cost in
 * ANCHOR units, and the charisma-scaled favorability gain. Invalid or
 * incomplete inputs reject with a typed error the shell surfaces; they never
 * silently resolve to neutral values.
 */
export type AdvertiseQuote =
  | { ok: true; apCost: number; fundCostAnchor: number; favorabilityGain: number }
  | { ok: false; error: string };

export function quoteAdvertiseAction(
  actor: AdvertiseQuoteActor,
  target?: AdvertiseQuoteTarget | null,
  // Optional (never defaulted): the resolved era price level from the shell
  // (#2119); 1 = modern, byte-identical to today.
  priceLevel = 1
): AdvertiseQuote {
  const favorability = actor.favorability;
  if (typeof favorability !== "number" || !Number.isFinite(favorability)) {
    return { ok: false, error: "Advertise requires a favorability value." };
  }
  const { charisma } = actor;
  if (typeof charisma !== "number" || !Number.isFinite(charisma)) {
    return {
      ok: false,
      error:
        "Advertise requires an allocated charisma stat. Allocate your stats before advertising.",
    };
  }
  if (!target) {
    return {
      ok: false,
      error: "Advertise requires home-state economic data (GDP and population).",
    };
  }
  const { gdpMillions, population, countryId } = target;
  const preset = target.preset ?? undefined;
  if (typeof gdpMillions !== "number" || !Number.isFinite(gdpMillions) || gdpMillions < 0) {
    return {
      ok: false,
      error: "Advertise requires home-state economic data (GDP and population).",
    };
  }
  if (typeof population !== "number" || !Number.isFinite(population) || population <= 0) {
    return {
      ok: false,
      error: "Advertise requires home-state economic data (GDP and population).",
    };
  }
  if (typeof countryId !== "string" || countryId.length === 0) {
    return { ok: false, error: "Advertise requires a country currency basis." };
  }
  const fundCostAnchor = getAdvertiseFundCost(
    favorability,
    gdpMillions,
    population,
    countryId,
    preset,
    priceLevel
  );
  // Charisma scales the diminishing-returns gain (gentle ±20%).
  const favorabilityGain = advertiseFavorabilityGain(favorability, statMultiplier(charisma));
  return {
    ok: true,
    apCost: getAdvertiseActionCost(favorability),
    fundCostAnchor,
    favorabilityGain,
  };
}

// ── BuildDonorBase (Game1724 slice 3) ───────────────────────────────────────
// Cost, eligibility and effect math moved verbatim from `../actions` so the UI
// quote, the execute shell and NPP callers share one implementation. Balance
// is unchanged: the numbers below are the historical formulas, only the owner
// moved. The strict entry point is quoteBuildDonorBaseAction; the lenient
// wrappers (getBuildDonorBaseActionCost/getBuildDonorBaseFundCost) stay for
// AP-only and NPP callers that never had stat/target context.

/** Base donor-network fund cost before level/GDP scaling, in ANCHOR units. */
export const BUILD_DONOR_BASE_FUND = 3_000;

/** Per-level donor-network fund cost, in ANCHOR units. */
export const BUILD_DONOR_BASE_FUND_PER_LEVEL = 1_500;

/** Donor levels gained per BuildDonorBase action. */
export const BUILD_DONOR_BASE_LEVEL_GAIN = 1;

/**
 * Fund cost for the BuildDonorBase action (0–75 level range).
 * Linear base: $3K + $1.5K/level, scaled by state GDP per capita (0.85–2.0×) vs
 * country baseline and (when threaded) the world-era price level (#2119).
 * Early levels are cheap (~$3K); L75 costs ~$116K (before GDP scaling).
 * Total 0→75 ≈ $4.4M at national-average GDP.
 */
export function getBuildDonorBaseFundCost(
  donorBaseLevel: number,
  stateGdpMillions: number,
  statePopulation: number,
  countryId = "US",
  // Optional (never defaulted): see getFundMultiplier.
  preset?: string,
  // Optional (never defaulted): resolved era price level; 1 = modern.
  priceLevel = 1
): number {
  const baseCost = BUILD_DONOR_BASE_FUND + donorBaseLevel * BUILD_DONOR_BASE_FUND_PER_LEVEL;
  const baseline = getGdpBaseline(countryId, preset);
  const gdpPerCapita = (stateGdpMillions * 1_000_000) / statePopulation;
  const gdpScalar = Math.max(0.85, Math.min(2.0, gdpPerCapita / baseline));
  return Math.round((baseCost * gdpScalar * priceLevel) / 1_000) * 1_000;
}

/**
 * Action-point cost for the BuildDonorBase action (0–75 level range).
 * Power curve from 4 AP (L0) to 20 AP (L75), notable high-end.
 *   Formula: min(20, round(4 + (level/75)^1.4 × 16))
 *   L0=4  L10=5  L25=8  L50=13  L65=17  L75=20
 */
export function getBuildDonorBaseActionCost(donorBaseLevel: number): number {
  return Math.min(20, Math.round(4 + Math.pow(donorBaseLevel / 75, 1.4) * 16));
}

/**
 * Raw BuildDonorBase actor inputs, preserved explicitly. The fundraising stat
 * arrives as the stored raw value (or missing for characters that predate the
 * stat system); the rules own the statMultiplier interpretation and reject a
 * missing stat instead of substituting the neutral fallback.
 */
export interface BuildDonorBaseQuoteActor {
  donorBaseLevel?: number | null;
  fundraising?: number | null;
}

/**
 * Raw BuildDonorBase target inputs, preserved explicitly. The state GDP,
 * population and country currency basis arrive as stored; the rules own the
 * GDP-scalar interpretation and reject a missing target instead of
 * substituting the flat fallback cost.
 */
export interface BuildDonorBaseQuoteTarget {
  gdpMillions?: number | null;
  population?: number | null;
  countryId?: string | null;
  /**
   * World reset preset selecting the GDP-baseline era. Absent (client previews
   * that have no world to ask) the modern-era baseline applies; runtime callers
   * pass the world's `gameState.preset`.
   */
  preset?: string | null;
}

/**
 * Authoritative BuildDonorBase quote: level-scaled AP cost, GDP-scaled fund
 * cost in ANCHOR units (after the fundraising cost-curve hook), and the donor
 * level gain. Invalid or incomplete inputs reject with a typed error the
 * shell surfaces; they never silently resolve to neutral values.
 */
export type BuildDonorBaseQuote =
  | { ok: true; apCost: number; fundCostAnchor: number; donorGain: number }
  | { ok: false; error: string };

export function quoteBuildDonorBaseAction(
  actor: BuildDonorBaseQuoteActor,
  target?: BuildDonorBaseQuoteTarget | null,
  // Optional (never defaulted): the resolved era price level from the shell
  // (#2119); 1 = modern, byte-identical to today.
  priceLevel = 1
): BuildDonorBaseQuote {
  const level = actor.donorBaseLevel;
  if (typeof level !== "number" || !Number.isFinite(level) || level < 0) {
    return { ok: false, error: "Build Donor Network requires a donor base level." };
  }
  const { fundraising } = actor;
  if (typeof fundraising !== "number" || !Number.isFinite(fundraising)) {
    return {
      ok: false,
      error:
        "Build Donor Network requires an allocated fundraising stat. Allocate your stats before expanding your network.",
    };
  }
  if (!target) {
    return {
      ok: false,
      error: "Build Donor Network requires home-state economic data (GDP and population).",
    };
  }
  const { gdpMillions, population, countryId } = target;
  const preset = target.preset ?? undefined;
  if (typeof gdpMillions !== "number" || !Number.isFinite(gdpMillions) || gdpMillions < 0) {
    return {
      ok: false,
      error: "Build Donor Network requires home-state economic data (GDP and population).",
    };
  }
  if (typeof population !== "number" || !Number.isFinite(population) || population <= 0) {
    return {
      ok: false,
      error: "Build Donor Network requires home-state economic data (GDP and population).",
    };
  }
  if (typeof countryId !== "string" || countryId.length === 0) {
    return { ok: false, error: "Build Donor Network requires a country currency basis." };
  }
  // Fundraising softens the donor-network cost curve (higher → cheaper).
  const fundCostAnchor = Math.round(
    getBuildDonorBaseFundCost(level, gdpMillions, population, countryId, preset, priceLevel) /
      statMultiplier(fundraising)
  );
  return {
    ok: true,
    apCost: getBuildDonorBaseActionCost(level),
    fundCostAnchor,
    donorGain: BUILD_DONOR_BASE_LEVEL_GAIN,
  };
}

// ── ConvertCash (Game1724 slice) ────────────────────────────────────────────
// Conversion, infamy and quote math moved verbatim from `../actions`, the
// execute shell and the AI advisor so the default effect, the atomic debit,
// the recommendation preview and the UI previews share one implementation.
// Balance is unchanged: the numbers below are the historical formulas, only
// the owner moved. The strict entry point is quoteConvertCashAction; the
// lenient helpers (calculateConvertCashInfamy/convertCashConversion) stay for
// callers that only need one leg. Host-currency balance selection (which
// personal bucket the debit targets, forex conversion at the write boundary)
// stays with the host shell: the quote prices LOCAL amounts and never touches
// persistence.

/** Action points charged per ConvertCash use: flat, independent of amount. */
export const CONVERT_CASH_ACTION_COST = 2;

/** Share of personal cash that lands in the campaign treasury. */
export const CONVERT_CASH_RATE = 0.5;

/**
 * Infamy gained from converting personal cash to campaign funds.
 * Power curve: 15 × (amount / $1M) ^ 0.564
 * ~4 at $100K, ~15 at $1M, ~55 at $10M, capped at 100.
 */
export function calculateConvertCashInfamy(amount: number): number {
  if (amount <= 0) return 0;
  const raw = 15 * Math.pow(amount / 1_000_000, 0.564);
  return Math.min(100, Math.round(raw));
}

/**
 * Campaign funds credited for a ConvertCash amount, in the same (LOCAL home
 * currency) units as the input. The remainder is lost to the transfer.
 */
export function convertCashConversion(amount: number): number {
  return Math.floor(amount * CONVERT_CASH_RATE);
}

/**
 * Raw ConvertCash actor inputs, preserved explicitly. The amount arrives in
 * the player's LOCAL home currency, matching the debit the execute shell
 * applies; the rules own the rate and infamy interpretation.
 */
export interface ConvertCashQuoteActor {
  amount?: number | null;
}

/**
 * Authoritative ConvertCash quote: flat AP cost, the LOCAL cash debit and
 * campaign credit, and the amount-scaled infamy. A missing or non-positive
 * amount rejects with a typed error the shell surfaces; it never silently
 * prices a zero conversion.
 */
export type ConvertCashQuote =
  | {
      ok: true;
      apCost: number;
      cashDebitLocal: number;
      convertedLocal: number;
      infamy: number;
    }
  | { ok: false; error: string };

export function quoteConvertCashAction(actor: ConvertCashQuoteActor): ConvertCashQuote {
  const { amount } = actor;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "You must specify an amount to convert." };
  }
  return {
    ok: true,
    apCost: CONVERT_CASH_ACTION_COST,
    cashDebitLocal: amount,
    convertedLocal: convertCashConversion(amount),
    infamy: calculateConvertCashInfamy(amount),
  };
}

// ── Poll (Game1724 slice) ───────────────────────────────────────────────────
// Cost math moved verbatim from `../actions` so the poll API route (GET quote
// and affordability, POST atomic debit), the poll page display, the action
// effect and canPerformAction share one implementation. Balance is unchanged:
// the numbers below are the historical formulas, only the owner moved. The
// strict entry point is quotePollAction; getPollBaseFundCost stays for
// display-only callers that must render a price when the quote rejects.

/** Poll tier: quick ("small") or full demographic ("large") poll. */
export type PollTier = "small" | "large";

/** Base quick-poll fund cost before the intellect hook, in ANCHOR units. */
export const POLL_BASE_FUND_COST = 25_000;

/** Base full-poll fund cost before the intellect hook, in ANCHOR units. */
export const POLL_LARGE_BASE_FUND_COST = 75_000;

/** Action-point cost for one quick poll. */
export const POLL_ACTION_COST = 2;

/** Action-point cost for one full demographic poll. */
export const POLL_LARGE_ACTION_COST = 6;

/**
 * Action-point cost for one poll of the given tier. Flat per tier: polls do
 * not scale AP with stats or state.
 */
export function getPollActionCost(tier: PollTier): number {
  return tier === "large" ? POLL_LARGE_ACTION_COST : POLL_ACTION_COST;
}

/**
 * Unscaled base fund cost for one poll of the given tier, in ANCHOR units.
 * Display-only fallback; execution always prices through quotePollAction.
 */
export function getPollBaseFundCost(tier: PollTier): number {
  return tier === "large" ? POLL_LARGE_BASE_FUND_COST : POLL_BASE_FUND_COST;
}

/**
 * Fund cost for one poll of the given tier, in ANCHOR units.
 * Intellect lowers polling cost (gentle ±20%), matching the historical
 * `../actions` effect math exactly. `priceLevel` (#2119) applies the world-era
 * deflator; 1 (the default) is today's behavior.
 */
export function getPollFundCost(tier: PollTier, intellect: number, priceLevel = 1): number {
  return Math.round((getPollBaseFundCost(tier) / statMultiplier(intellect)) * priceLevel);
}

/**
 * Raw poll actor inputs, preserved explicitly. The stored raw intellect
 * arrives as-is (or missing for characters that predate the stat system);
 * the rules own the statMultiplier interpretation and reject a missing stat
 * instead of substituting the neutral fallback.
 */
export interface PollQuoteActor {
  intellect?: number | null;
}

/**
 * Authoritative poll quote: flat AP cost and the intellect-scaled fund cost
 * in ANCHOR units. A missing or invalid intellect rejects with a typed error
 * the shell surfaces; it never silently resolves to the unscaled base.
 */
export type PollQuote =
  { ok: true; apCost: number; fundCostAnchor: number } | { ok: false; error: string };

// ── Fundraise (Game1724 slice) ──────────────────────────────────────────────
// Eligibility, AP cost and yield math moved verbatim from `../actions` (the
// effect, the donor gate and the flat cost) so the UI card, the action
// effect, canPerformAction, the AI advisor and the client-status projection
// share one implementation. Balance is unchanged: flat 3 AP, the $50K +
// $2K/level base with the influence multiplier, and the fundraising-stat
// scaling are the historical numbers, only the owner moved. The strict entry
// point is quoteFundraiseAction; fundraiseYieldAnchor stays for the
// anchor→local converters and isFundraiseEligible stays for UI blocked-state
// probes that never had yield context. Unlike the GDP-scaled slices there is
// no target, no cap and no rounding beyond the yield's own Math.round: the
// quote prices ANCHOR units and hosts own the anchor→local conversion.

/** Rejection when the character has no donor base. Mirrors the execute gate. */
export const FUNDRAISE_NO_DONOR_ERROR =
  "You have no donor base. Use 'Build Donor Network' first to establish one before fundraising.";

/**
 * Raw fundraise actor inputs, preserved explicitly. Stats arrive as the
 * stored raw values (or missing for characters that predate the stat
 * system); the rules own the statMultiplier interpretation and keep the
 * neutral fallback the effect always applied, so the quote matches the
 * credit for pre-stat characters.
 */
export interface FundraiseQuoteActor {
  donorBaseLevel?: number | null;
  politicalInfluence?: number | null;
  fundraising?: number | null;
}

/**
 * Authoritative fundraise quote: flat AP cost and the stat-scaled yield in
 * ANCHOR units. A zero donor base rejects with a typed error the shell
 * surfaces; it never silently prices a yield that cannot be earned.
 */
export type FundraiseQuote =
  { ok: true; apCost: number; yieldAnchor: number } | { ok: false; error: string };

export function quoteFundraiseAction(actor: FundraiseQuoteActor, priceLevel = 1): FundraiseQuote {
  const { donorBaseLevel } = actor;
  if (!isFundraiseEligible(donorBaseLevel ?? undefined)) {
    return { ok: false, error: FUNDRAISE_NO_DONOR_ERROR };
  }
  // Eligible ⟹ non-zero; the mapping below preserves the effect's historical
  // neutral fallbacks exactly (missing influence → 0, missing stat → neutral).
  const yieldAnchor = fundraiseYieldAnchor(
    {
      donorBaseLevel: donorBaseLevel as number,
      politicalInfluence: actor.politicalInfluence ?? undefined,
      stats: actor.fundraising == null ? undefined : { fundraising: actor.fundraising },
    },
    priceLevel
  );
  return { ok: true, apCost: FUNDRAISE_ACTION_COST, yieldAnchor };
}

export function quotePollAction(
  actor: PollQuoteActor,
  tier: PollTier,
  // Optional (never defaulted): resolved era price level; 1 = modern.
  priceLevel = 1
): PollQuote {
  const { intellect } = actor;
  if (typeof intellect !== "number" || !Number.isFinite(intellect)) {
    return {
      ok: false,
      error:
        "Polling requires an allocated intellect stat. Allocate your stats before commissioning a poll.",
    };
  }
  return {
    ok: true,
    apCost: getPollActionCost(tier),
    fundCostAnchor: getPollFundCost(tier, intellect, priceLevel),
  };
}

// ── Rest (Game1724 slice) ─────────────────────────────────────────────────────
// Cost math moved verbatim from `../actions` so the action effect,
// canPerformAction, the turn dashboard cost map and the AI advisor share one
// implementation. Balance is unchanged: rest has always been free and always
// eligible, only the owner moved. quoteRestAction takes no actor because rest
// has no stat, target or world context to interpret.

/** Action-point cost for Rest: always free. */
export const REST_ACTION_COST = 0;

/** Rest result message, shared by the effect and any UI preview. */
export const REST_RESULT_MESSAGE = "You took a well-deserved break.";

/**
 * Authoritative rest quote: zero AP cost and zero fund cost in ANCHOR units.
 * Rest never rejects: no flags, caps, targets, funds, rounding or error
 * cases. The `ok: false` arm keeps the shared quote shape so every consumer
 * validates through the same narrow-then-read path as the other actions.
 */
export type RestQuote =
  { ok: true; apCost: number; fundCostAnchor: number } | { ok: false; error: string };

export function quoteRestAction(): RestQuote {
  return { ok: true, apCost: REST_ACTION_COST, fundCostAnchor: 0 };
}

// ── DebatePrep (Game1724 slice) ───────────────────────────────────────────────
// Cost, chance and eligibility math moved verbatim from `../actions` (base
// cost, description), `../stats/statsConstants` (cost and chance constants)
// and the execute shell (flag + stat-block gates) so the UI card, the action
// definition, canPerformAction and the execute gate share one implementation.
// Balance is unchanged: flat 1 AP and the fixed success chance are the
// historical numbers, only the owner moved. The strict entry point is
// quoteDebatePrepAction. The attempt roll itself stays in
// `../stats/debatePrep` (injected rng, deterministically testable); the quote
// re-exports the chance constant the roll compares against so the advertised
// odds and the resolved odds cannot drift (the card previously advertised
// 10% while the roll resolved 15%).

/** Action points charged per Debate Prep attempt: flat, win or lose. */
export { DEBATE_PREP_ACTION_COST };

/** Fixed chance one Debate Prep attempt raises Debate by 1 (0–1). */
export { DEBATE_PREP_SUCCESS_CHANCE };

/** Debate skill points gained on a successful Debate Prep attempt. */
export const DEBATE_PREP_DEBATE_GAIN = 1;

/** Rejection when the RPG stat system flag is off. Mirrors the execute gate. */
export const DEBATE_PREP_DISABLED_ERROR = "The stat system is not currently enabled.";

/** Rejection when the character has no allocated stat block. Mirrors the execute gate. */
export const DEBATE_PREP_UNALLOCATED_ERROR = "Allocate your stats before using Debate Prep.";

/**
 * Raw DebatePrep actor inputs, preserved explicitly. `hasStats` carries
 * whether the character has an allocated stat block (Debate lives in stats);
 * `debate` is the stored raw value. Missing either rejects instead of
 * charging for a roll that cannot land.
 */
export interface DebatePrepQuoteActor {
  debate?: number | null;
  hasStats?: boolean;
}

/**
 * Host-supplied context the rules cannot read themselves: the async RPG-stats
 * feature flag. Omitted (or true) skips the flag leg for callers that cannot
 * know it (canPerformAction, UI quotes); the execute shell always passes the
 * resolved value. Explicit false rejects, mirroring the execute gate.
 */
export interface DebatePrepQuoteOptions {
  rpgStatsEnabled?: boolean;
}

/**
 * Authoritative Debate Prep quote: flat AP cost, the fixed success chance,
 * and the Debate gain (0 when already at the stat cap). At-cap attempts stay
 * quotable — execution historically still charges the AP and rolls — so the
 * quote reports `capped` instead of rejecting; callers render the maxed state
 * from it.
 */
export type DebatePrepQuote =
  | {
      ok: true;
      apCost: number;
      successChance: number;
      debateGain: number;
      capped: boolean;
    }
  | { ok: false; error: string };

export function quoteDebatePrepAction(
  actor: DebatePrepQuoteActor,
  options?: DebatePrepQuoteOptions
): DebatePrepQuote {
  if (options?.rpgStatsEnabled === false) {
    return { ok: false, error: DEBATE_PREP_DISABLED_ERROR };
  }
  if (!actor.hasStats) {
    return { ok: false, error: DEBATE_PREP_UNALLOCATED_ERROR };
  }
  const { debate } = actor;
  if (typeof debate !== "number" || !Number.isFinite(debate)) {
    return { ok: false, error: DEBATE_PREP_UNALLOCATED_ERROR };
  }
  if (debate >= STAT_MAX) {
    return {
      ok: true,
      apCost: DEBATE_PREP_ACTION_COST,
      successChance: DEBATE_PREP_SUCCESS_CHANCE,
      debateGain: 0,
      capped: true,
    };
  }
  return {
    ok: true,
    apCost: DEBATE_PREP_ACTION_COST,
    successChance: DEBATE_PREP_SUCCESS_CHANCE,
    debateGain: DEBATE_PREP_DEBATE_GAIN,
    capped: false,
  };
}

/**
 * Card effect label for Debate Prep, derived from the resolved chance
 * constant so the advertised odds cannot drift from the roll.
 */
export function describeDebatePrepEffect(): string {
  return `${Math.round(DEBATE_PREP_SUCCESS_CHANCE * 100)}% chance: +1 Debate`;
}

/**
 * Action definition description for Debate Prep, derived from the resolved
 * chance constant so the definition cannot drift from the roll.
 */
export function describeDebatePrepAction(): string {
  return (
    "Study briefing books and rehearse. " +
    `${Math.round(DEBATE_PREP_SUCCESS_CHANCE * 100)}% chance to raise your Debate skill by 1. ` +
    "No fund cost."
  );
}
